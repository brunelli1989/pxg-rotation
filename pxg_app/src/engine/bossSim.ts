import type { DamageConfig, Pokemon, PokemonElement, XAtkTier } from "../types";
import { computeSkillDamage, resolveSkillPower } from "./damage";

export const SIM_DURATION = 600;
const CAST_TIME = 1;

export interface PokeHeld {
  boost: number;
  xAtkTier: XAtkTier;
  xBoostTier: XAtkTier;
}

export const DEFAULT_HELD: PokeHeld = { boost: 70, xAtkTier: 8, xBoostTier: 0 };

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

/** True se o poke tem ao menos uma skill com dano calibrado (>0) — usado pra filtrar
 *  pokes sem dano modelado da lista de comparação. */
export function pokeHasCalibratedDamage(poke: Pokemon): boolean {
  return poke.skills.some((s) => (resolveSkillPower(s, poke) ?? 0) > 0);
}

/**
 * Boss fights não aplicam bônus de clã, então clan é forçado a null.
 * targetTypes define o(s) elemento(s) do alvo — engine aplica eff (PxG piecewise).
 * defFactor = 1 (boss já tem stats próprios, eff cobre matchup).
 */
export function buildBossDamageConfig(
  playerLvl: number,
  held: PokeHeld,
  pokeId: string,
  targetTypes: PokemonElement[]
): DamageConfig {
  return {
    playerLvl,
    clan: null,
    hunt: "300",
    mob: { name: "target", types: targetTypes, hp: 0, defFactor: 1 },
    device: held.xBoostTier > 0 ? { kind: "x-boost", tier: held.xBoostTier } : { kind: "x-attack", tier: 0 },
    pokeSetups: {
      [pokeId]: {
        boost: held.boost,
        held: { kind: "x-attack", tier: held.xAtkTier },
        hasDevice: held.xBoostTier > 0,
      },
    },
    skillCalibrations: {},
  };
}

/**
 * Simula 600s (10 min) de casting greedy:
 * - A cada segundo, casta a skill com maior dano disponível (fora do CD)
 * - CD começa após o cast (clock + cd + cast_time)
 * - Sem buff modeling por enquanto (Rage ×2/20s não aplicado).
 */
function simulate10min(
  poke: Pokemon,
  cfg: DamageConfig
): { totalDmg: number; totalCasts: number; perSkill: Map<string, { casts: number; dmg: number }> } {
  const damageSkills = poke.skills.filter((s) => (resolveSkillPower(s, poke) ?? 0) > 0);
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

  while (t < SIM_DURATION) {
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
  targetTypes: PokemonElement[]
): PokeRow {
  const damageSkills = poke.skills.filter((s) => (resolveSkillPower(s, poke) ?? 0) > 0);
  const cfg = buildBossDamageConfig(playerLvl, held, poke.id, targetTypes);
  const sim = simulate10min(poke, cfg);

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
    meleeHits = Math.floor(SIM_DURATION / poke.melee.attackInterval);
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
 * Cache de PokeRow per (poke, held, playerLvl, target). Mudar held de UM poke
 * só invalida a entrada dele — outros reusam cache. Crítico pra perf da OTDD
 * (97 pokes) e Comparar (até pool inteiro).
 */
export function createPokeRowCache() {
  const cache = new Map<string, PokeRow>();
  return {
    get(poke: Pokemon, held: PokeHeld, playerLvl: number, targetTypes: PokemonElement[]): PokeRow {
      const key = `${poke.id}|${held.boost}|${held.xAtkTier}|${held.xBoostTier}|${playerLvl}|${targetTypes.join(",")}`;
      let row = cache.get(key);
      if (!row) {
        row = computePokeRow(poke, held, playerLvl, targetTypes);
        cache.set(key, row);
      }
      return row;
    },
    clear() {
      cache.clear();
    },
  };
}
