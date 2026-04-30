import type { DamageConfig, Pokemon, PokemonElement, XAtkTier } from "../types";
import { computeSkillDamage, resolveSkillPower } from "./damage";

export const DEFAULT_SIM_DURATION = 600;
const CAST_TIME = 1;

export type HeldKindShort = "x-attack" | "x-boost" | "x-critical";
export type DeviceKindShort = "none" | "x-boost" | "x-critical";

/** Tier → % de crit do X-Critical (wiki PxG). T1=8% até T8=27%. */
export const X_CRITICAL_PCT_BY_TIER: Record<XAtkTier, number> = {
  0: 0, 1: 8, 2: 10, 3: 12, 4: 14, 5: 16, 6: 20, 7: 24, 8: 27,
};

export interface PokeHeld {
  boost: number;
  // X-Held do poke (slot do bicho)
  heldKind: HeldKindShort;
  heldTier: XAtkTier;       // x-attack/x-boost OU x-critical (vira % via X_CRITICAL_PCT_BY_TIER)
  // Device (slot do char, separado)
  deviceKind: DeviceKindShort;
  deviceTier: XAtkTier;     // x-boost OU x-critical (mesma lógica)
}

export const DEFAULT_HELD: PokeHeld = {
  boost: 70,
  heldKind: "x-attack",
  heldTier: 8,
  deviceKind: "none",
  deviceTier: 0,
};

export interface SkillRow {
  name: string;
  element: string;
  cooldown: number;
  power: number;
  danoPerCast: number;
  casts: number;
  totalDmg: number;
  playerNote?: string;
}

export interface PokeRow {
  poke: Pokemon;
  held: PokeHeld;
  totalDmg: number;
  meleeDmg: number;
  meleeIncludedInTotal: boolean;
  skillsDmg: number;
  totalCasts: number;
  meleeHits: number;
  skillRows: SkillRow[];
}

/** True se o poke tem ao menos uma skill com `power` EXPLÍCITO calibrado (>0).
 *  NÃO usa o fallback tier-based de resolveSkillPower — pokes sem calibração
 *  in-game ficam fora da Compare (caso contrário teríamos defaults inflados
 *  vs valores reais medidos). */
export function pokeHasCalibratedDamage(poke: Pokemon): boolean {
  return poke.skills.some((s) => s.power !== undefined && s.power > 0);
}

/** Skill conta como calibrada na sim de boss apenas se tem `power` explícito.
 *  Skills sem power (que cairiam no fallback tier) contribuem 0 — assim a
 *  comparação só conta dano realmente medido in-game. */
function hasExplicitPower(skill: { power?: number }): boolean {
  return skill.power !== undefined && skill.power > 0;
}

/**
 * Boss fights não aplicam bônus de clã, então clan é forçado a null.
 * targetTypes define o(s) elemento(s) do alvo — engine aplica eff (PxG piecewise).
 * defFactor = 1 (boss já tem stats próprios, eff cobre matchup).
 * foodAtkPct: bônus de food já dobrado pelo boss (caller calcula 2× quando aplicável).
 */
export function buildBossDamageConfig(
  playerLvl: number,
  held: PokeHeld,
  pokeId: string,
  targetTypes: PokemonElement[],
  foodAtkPct: number = 0
): DamageConfig {
  // X-Critical não afeta dmg (só crit pós-multiplier no caller), mapeia pra "none" no engine.
  const pokeHeldItem =
    held.heldKind === "x-critical"
      ? { kind: "none" as const, tier: 0 as XAtkTier }
      : { kind: held.heldKind, tier: held.heldTier };
  const deviceHeldItem =
    held.deviceKind === "x-boost"
      ? { kind: "x-boost" as const, tier: held.deviceTier }
      : { kind: "x-attack" as const, tier: 0 as XAtkTier }; // none/x-critical = dmg-neutro
  const hasDevice = held.deviceKind !== "none";
  return {
    playerLvl,
    clan: null,
    hunt: "300",
    mob: { name: "target", types: targetTypes, hp: 0, defFactor: 1 },
    device: deviceHeldItem,
    pokeSetups: {
      [pokeId]: {
        boost: held.boost,
        held: pokeHeldItem,
        hasDevice,
      },
    },
    skillCalibrations: {},
    foodAtkPct,
  };
}

/**
 * Simula `duration` segundos de casting greedy:
 * - A cada segundo, casta a skill com maior dano disponível (fora do CD)
 * - CD começa após o cast (clock + cd + cast_time)
 * - Sem buff modeling por enquanto (Rage ×2/20s não aplicado).
 */
function simulateBossFight(
  poke: Pokemon,
  cfg: DamageConfig,
  duration: number
): { totalDmg: number; totalCasts: number; perSkill: Map<string, { casts: number; dmg: number }> } {
  // Apenas skills com power explícito — sem fallback tier (evita inflar dmg de pokes
  // não calibrados na Compare).
  const damageSkills = poke.skills.filter(hasExplicitPower);
  if (damageSkills.length === 0) {
    return { totalDmg: 0, totalCasts: 0, perSkill: new Map() };
  }

  const skillData = damageSkills.map((skill) => {
    const power = resolveSkillPower(skill, poke);
    const dano = computeSkillDamage(cfg, poke, skill, cfg.mob, { skillPower: power });
    return { skill, dano };
  });
  skillData.sort((a, b) => b.dano - a.dano);

  const cooldowns = new Array<number>(skillData.length).fill(0);
  const casts = new Array<number>(skillData.length).fill(0);
  const dmgs = new Array<number>(skillData.length).fill(0);

  let t = 0;
  let totalDmg = 0;
  let totalCasts = 0;

  while (t < duration) {
    let bestIdx = -1;
    for (let i = 0; i < skillData.length; i++) {
      if (cooldowns[i] <= t) {
        bestIdx = i;
        break;
      }
    }
    if (bestIdx === -1) {
      const nextReady = Math.min(...cooldowns.filter((c) => c > t));
      t = nextReady;
      continue;
    }
    const { skill, dano } = skillData[bestIdx];
    casts[bestIdx]++;
    dmgs[bestIdx] += dano;
    totalDmg += dano;
    totalCasts++;
    cooldowns[bestIdx] = t + skill.cooldown;
    t += CAST_TIME;
  }

  const perSkill = new Map<string, { casts: number; dmg: number }>();
  skillData.forEach((sd, i) => {
    perSkill.set(sd.skill.name, { casts: casts[i], dmg: dmgs[i] });
  });
  return { totalDmg, totalCasts, perSkill };
}

function computePokeRow(
  poke: Pokemon,
  held: PokeHeld,
  playerLvl: number,
  targetTypes: PokemonElement[],
  duration: number,
  foodAtkPct: number
): PokeRow {
  const damageSkills = poke.skills.filter(hasExplicitPower);
  const cfg = buildBossDamageConfig(playerLvl, held, poke.id, targetTypes, foodAtkPct);
  const sim = simulateBossFight(poke, cfg, duration);

  const skillRows: SkillRow[] = damageSkills.map((skill) => {
    const power = resolveSkillPower(skill, poke);
    const danoPerCast = computeSkillDamage(cfg, poke, skill, cfg.mob, { skillPower: power });
    const stats = sim.perSkill.get(skill.name) ?? { casts: 0, dmg: 0 };
    return {
      name: skill.name,
      element: skill.element ?? "—",
      cooldown: skill.cooldown,
      power,
      danoPerCast,
      casts: stats.casts,
      totalDmg: stats.dmg,
      playerNote: skill.playerNote,
    };
  });

  let meleeHits = 0;
  let meleeDmg = 0;
  let meleeIncludedInTotal = false;
  if (poke.melee && poke.melee.attackInterval > 0) {
    meleeHits = Math.floor(duration / poke.melee.attackInterval);
    const meleeSkill = {
      name: "Auto-attack",
      cooldown: poke.melee.attackInterval,
      type: "target" as const,
      cc: null,
      buff: null,
      element: poke.melee.element,
      power: poke.melee.power,
    };
    const meleeDmgPerHit = computeSkillDamage(cfg, poke, meleeSkill, cfg.mob, { skillPower: poke.melee.power });
    meleeDmg = meleeDmgPerHit * meleeHits;
    meleeIncludedInTotal = poke.melee.kind === "ranged";
  }

  return {
    poke,
    held,
    totalDmg: sim.totalDmg + (meleeIncludedInTotal ? meleeDmg : 0),
    meleeDmg,
    meleeIncludedInTotal,
    skillsDmg: sim.totalDmg,
    totalCasts: sim.totalCasts,
    meleeHits,
    skillRows,
  };
}

/**
 * Cache de PokeRow per (poke, held, playerLvl, target, duration, foodAtkPct).
 * Mudar held de UM poke só invalida a entrada dele — outros reusam cache.
 * foodAtkPct entra na key porque afeta o multiplier `helds` na fórmula.
 */
export function createPokeRowCache() {
  const cache = new Map<string, PokeRow>();
  return {
    get(
      poke: Pokemon,
      held: PokeHeld,
      playerLvl: number,
      targetTypes: PokemonElement[],
      duration: number,
      foodAtkPct: number = 0
    ): PokeRow {
      // X-Critical não afeta dmg (crit é pós-mult). Mas heldKind/deviceKind importam —
      // mudam como o tier é interpretado (atk%/boost vs crit%).
      const key = `${poke.id}|${held.boost}|${held.heldKind}|${held.heldTier}|${held.deviceKind}|${held.deviceTier}|${playerLvl}|${targetTypes.join(",")}|${duration}|${foodAtkPct}`;
      let row = cache.get(key);
      if (!row) {
        row = computePokeRow(poke, held, playerLvl, targetTypes, duration, foodAtkPct);
        cache.set(key, row);
      }
      return row;
    },
    clear() {
      cache.clear();
    },
  };
}
