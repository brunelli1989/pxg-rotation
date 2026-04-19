import type {
  ClanName,
  DamageConfig,
  HuntLevel,
  Lure,
  MobConfig,
  MobEntry,
  Pokemon,
  PokemonElement,
  PokemonRole,
  Skill,
  Tier,
  XAtkTier,
} from "../types";
import clansData from "../data/clans.json";

// =========================================================
// Default skill_power per (tier, role) — fallback pra pokes não calibrados.
// Valores derivados de calibrações reais no dummy (média simples por slot).
// =========================================================

// Média de skill_power por (tier, role) derivada de pokes calibrados no dummy.
// burst_dd escala por tier; offensive_tank é flat entre tiers (Sh.Golem T2 ≈ Omastar T3).
type TierRoleKey = `${Tier}:${PokemonRole}`;
const DEFAULT_POWER_BY_TIER_ROLE: Partial<Record<TierRoleKey, number>> = {
  "T1H:burst_dd":       24.7,
  "T1H:offensive_tank": 19.4,
  "T2:burst_dd":        22.5,
  "T2:offensive_tank":  19.4,
  "T3:burst_dd":        21.5,
  "T3:offensive_tank":  19.4,
  "TM:burst_dd":        15.0,
  "TM:offensive_tank":  19.4,
  "TR:burst_dd":        18.4,
};

export function getDefaultSkillPower(tier: Tier, role: PokemonRole | undefined): number {
  if (!role) return 0;
  return DEFAULT_POWER_BY_TIER_ROLE[`${tier}:${role}` as TierRoleKey] ?? 0;
}

/**
 * Resolve o power de uma skill: calibrado se existir, senão fallback por (tier, role).
 * Skills com buff (self ou next) e power = 0 (CC-only) não recebem fallback — são 0.
 * Resultado cacheado por (poke, skill) — invariante no hot path do beam search.
 */
const resolvedPowerCache = new WeakMap<Pokemon, WeakMap<Skill, number>>();

export function resolveSkillPower(skill: Skill, poke: Pokemon): number {
  let bySkill = resolvedPowerCache.get(poke);
  if (bySkill) {
    const cached = bySkill.get(skill);
    if (cached !== undefined) return cached;
  } else {
    bySkill = new WeakMap();
    resolvedPowerCache.set(poke, bySkill);
  }
  let result: number;
  if (skill.power !== undefined) result = skill.power;
  else if (skill.buff !== null) result = 0;
  else result = getDefaultSkillPower(poke.tier, poke.role);
  bySkill.set(skill, result);
  return result;
}

// =========================================================
// Constants (validated empirically, <0.2% precision cross-char)
// =========================================================

const BOOST_COEF = 1.3;
const FORMULA_CONSTANT = 150;
const BUFF_NEXT_MULTIPLIER = 1.5; // +50% na próxima skill

// Fallback quando mob não tem defFactor calibrado (média dos mobs testados no dummy).
export const DEFAULT_MOB_DEF_FACTOR = 0.85;

// =========================================================
// Mob resolver — preenche HP/defFactor ausentes via fallback hierárquico:
// 1. valor explícito no mobs.json
// 2. dentro do grupo: mobs irmãos têm mesmo effective_HP (HP × 1/defFactor)
// 3. média de effective_HP do hunt tier (cross-group)
// 4. DEFAULT_MOB_DEF_FACTOR
// =========================================================

export type MobFieldSource = "measured" | "group" | "hunt-avg" | "default";

export interface ResolvedMob extends MobConfig {
  hpSource: MobFieldSource;
  defSource: MobFieldSource;
}

function groupEffHp(entry: MobEntry, allMobs: MobEntry[]): number | undefined {
  const anchor = allMobs.find(
    (m) => m.group === entry.group && m.hp !== undefined && m.defFactor !== undefined
  );
  return anchor ? anchor.hp! / anchor.defFactor! : undefined;
}

function huntAvgEffHp(hunt: HuntLevel, allMobs: MobEntry[]): number | undefined {
  const samples = allMobs
    .filter((m) => m.hunt === hunt && m.hp !== undefined && m.defFactor !== undefined)
    .map((m) => m.hp! / m.defFactor!);
  if (samples.length === 0) return undefined;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

export function resolveMobConfig(entry: MobEntry, allMobs: MobEntry[]): ResolvedMob {
  let hp = entry.hp;
  let def = entry.defFactor;
  let hpSource: MobFieldSource = hp !== undefined ? "measured" : "default";
  let defSource: MobFieldSource = def !== undefined ? "measured" : "default";

  const effGroup = groupEffHp(entry, allMobs);
  if (effGroup !== undefined) {
    if (hp === undefined && def !== undefined) {
      hp = Math.round(effGroup * def);
      hpSource = "group";
    } else if (def === undefined && hp !== undefined) {
      def = Number((hp / effGroup).toFixed(3));
      defSource = "group";
    }
  }

  if (hp === undefined) {
    const effHunt = huntAvgEffHp(entry.hunt, allMobs);
    const usedDef = def ?? DEFAULT_MOB_DEF_FACTOR;
    if (effHunt !== undefined) {
      hp = Math.round(effHunt * usedDef);
      hpSource = "hunt-avg";
    }
  }

  return {
    name: entry.name,
    types: entry.types,
    hp: hp ?? 0,
    defFactor: def,
    hpSource,
    defSource,
  };
}

// X-Attack tier bonuses (aditivos)
const X_ATK_BONUSES: Record<XAtkTier, number> = {
  0: 0,
  1: 0.08,
  2: 0.12,
  3: 0.16,
  4: 0.19,
  5: 0.22,
  6: 0.25,
  7: 0.28,
  8: 0.31,
};

// X-Boost tier bonuses dependem do level do player.
// Tabela baseada em wiki. X-Boost só vai até T7. Faixas: 0-99, 100-149, 150-399, 400-625.
const X_BOOST_BY_RANGE: Partial<Record<XAtkTier, number[]>> = {
  0: [0, 0, 0, 0],
  1: [6, 9, 12, 15],
  2: [8, 12, 16, 20],
  3: [10, 15, 20, 25],
  4: [12, 18, 24, 30],
  5: [14, 21, 28, 35],
  6: [16, 24, 32, 40],
  7: [18, 27, 36, 45],
};

export const MAX_X_BOOST_TIER: XAtkTier = 7;

function xBoostBonus(tier: XAtkTier | undefined, playerLvl: number): number {
  if (!tier) return 0;
  const range = playerLvl <= 99 ? 0 : playerLvl <= 149 ? 1 : playerLvl <= 399 ? 2 : 3;
  return X_BOOST_BY_RANGE[tier]?.[range] ?? 0;
}

function computeEffectiveBoost(
  boost: number,
  xBoostTier: XAtkTier,
  hasDevice: boolean,
  deviceXBoostTier: XAtkTier,
  playerLvl: number
): number {
  // Regra: se ambos helds são X-Boost, usa o MAIOR (não soma)
  const mainBonus = xBoostBonus(xBoostTier, playerLvl);
  const deviceBonus = hasDevice ? xBoostBonus(deviceXBoostTier, playerLvl) : 0;
  return boost + Math.max(mainBonus, deviceBonus);
}

// =========================================================
// Type effectiveness chart (standard Pokemon — validated in PxG)
// =========================================================

type TypeChart = Record<PokemonElement, Partial<Record<PokemonElement, number>>>;

const TYPE_CHART: TypeChart = {
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
  ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
  poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
  ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
  rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
  dragon: { dragon: 2, steel: 0.5, fairy: 0 },
  dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
  steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
  fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
};

export function getEffectiveness(
  attackerType: PokemonElement,
  defenderType: PokemonElement
): number {
  return TYPE_CHART[attackerType]?.[defenderType] ?? 1;
}

/**
 * PxG usa regras customizadas pra tipo duplo (não é multiplicativo como mainline):
 * - Ambos fracos: 2.0×
 * - Só um fraco (outro neutro): 1.75×
 * - Fraco + resistente: 1.0×
 * - Ambos resistentes: 0.5×
 * - Um resist + um neutro: 0.5×
 * - Um imune: 0× (PvE)
 * - Ambos neutros: 1.0×
 */
export function computeEffectiveness(
  attackerType: PokemonElement,
  defenderTypes: PokemonElement[]
): number {
  if (defenderTypes.length === 0) return 1;
  if (defenderTypes.length === 1) return getEffectiveness(attackerType, defenderTypes[0]);

  const [e1, e2] = defenderTypes.map((t) => getEffectiveness(attackerType, t));

  if (e1 === 0 || e2 === 0) return 0;

  const weak1 = e1 >= 2;
  const weak2 = e2 >= 2;
  const resist1 = e1 <= 0.5;
  const resist2 = e2 <= 0.5;

  if (weak1 && weak2) return 2.0;
  if ((weak1 && resist2) || (weak2 && resist1)) return 1.0;
  if (weak1 || weak2) return 1.75;
  if (resist1 || resist2) return 0.5;
  return 1.0;
}

// =========================================================
// Clan bonus lookup
// =========================================================

// Pré-indexa clãs → elemento → bônus de atk. Lookup O(1) no hot path.
const CLAN_ATK_BONUS: Map<ClanName, Map<PokemonElement, number>> = new Map(
  clansData.map((c) => [
    c.name as ClanName,
    new Map(c.bonuses.map((b) => [b.element as PokemonElement, b.atk])),
  ])
);

export function getClanBonus(
  clanName: ClanName | null,
  skillElement: PokemonElement | undefined
): number {
  if (!clanName || !skillElement) return 0;
  return CLAN_ATK_BONUS.get(clanName)?.get(skillElement) ?? 0;
}

// =========================================================
// Core damage formula
// =========================================================

/**
 * dmg = (player_lvl + 1.3 × boost + 150) × skill_power × (1 + Σ atk%) × (1 + clã) × eff × def_mob
 *
 * `skill.power` não calibrado cai no fallback por (poke.tier, poke.role).
 */
export function computeSkillDamage(
  cfg: DamageConfig,
  poke: Pokemon,
  skill: Skill,
  mob: MobConfig = cfg.mob,
  opts: { buffedByPrevious?: boolean; skillPower?: number } = {}
): number {
  const setup = cfg.pokeSetups[poke.id];
  if (!setup) return 0;

  const skillPower = opts.skillPower ?? resolveSkillPower(skill, poke);
  if (skillPower === 0) return 0;

  const deviceActive = setup.hasDevice;
  const pokeBoostTier: XAtkTier = setup.held.kind === "x-boost" ? setup.held.tier : 0;
  const deviceBoostTier: XAtkTier =
    deviceActive && cfg.device.kind === "x-boost" ? cfg.device.tier : 0;
  const effectiveBoost = computeEffectiveBoost(
    setup.boost,
    pokeBoostTier,
    true,
    deviceBoostTier,
    cfg.playerLvl
  );
  const base = cfg.playerLvl + BOOST_COEF * effectiveBoost + FORMULA_CONSTANT;
  const pokeAtk = setup.held.kind === "x-attack" ? X_ATK_BONUSES[setup.held.tier] : 0;
  const deviceAtk =
    deviceActive && cfg.device.kind === "x-attack" ? X_ATK_BONUSES[cfg.device.tier] : 0;
  const helds = 1 + pokeAtk + deviceAtk;
  const clã = 1 + getClanBonus(cfg.clan, skill.element);
  const eff = skill.element ? computeEffectiveness(skill.element, mob.types) : 1;
  const buffMult = opts.buffedByPrevious ? BUFF_NEXT_MULTIPLIER : 1;

  const defFactor = mob.defFactor ?? DEFAULT_MOB_DEF_FACTOR;
  return base * skillPower * helds * clã * eff * defFactor * buffMult;
}

/**
 * Inversa da fórmula: dado dano observado no dummy (def=1, eff=1), deriva skill_power.
 * Usado no modo calibração.
 */
export function deriveSkillPower(
  observedDmg: number,
  cfg: DamageConfig,
  pokeId: string,
  skill: Skill
): number {
  const setup = cfg.pokeSetups[pokeId];
  if (!setup) return 0;

  const deviceActive = setup.hasDevice;
  const pokeBoostTier: XAtkTier = setup.held.kind === "x-boost" ? setup.held.tier : 0;
  const deviceBoostTier: XAtkTier =
    deviceActive && cfg.device.kind === "x-boost" ? cfg.device.tier : 0;
  const effectiveBoost = computeEffectiveBoost(
    setup.boost,
    pokeBoostTier,
    true,
    deviceBoostTier,
    cfg.playerLvl
  );
  const base = cfg.playerLvl + BOOST_COEF * effectiveBoost + FORMULA_CONSTANT;
  const pokeAtk = setup.held.kind === "x-attack" ? X_ATK_BONUSES[setup.held.tier] : 0;
  const deviceAtk =
    deviceActive && cfg.device.kind === "x-attack" ? X_ATK_BONUSES[cfg.device.tier] : 0;
  const helds = 1 + pokeAtk + deviceAtk;
  const clã = 1 + getClanBonus(cfg.clan, skill.element);

  // Dummy neutro: eff = 1, defFactor = 1
  return observedDmg / (base * helds * clã);
}

// =========================================================
// Lure damage estimation
// =========================================================

/**
 * Soma o dano de todas as skills castadas no lure, considerando buff_next.
 * Assume todas as skills são area (hittam cada mob).
 */
export function estimateLureDamagePerMob(
  lure: Lure,
  cfg: DamageConfig,
  mob: MobConfig = cfg.mob
): number {
  let totalDmg = 0;

  const castSequence: { poke: Pokemon; skill: Skill }[] = [];
  for (const s of lure.starterSkills) {
    castSequence.push({ poke: lure.starter, skill: s });
  }
  if (lure.second) {
    for (const s of lure.secondSkills) {
      castSequence.push({ poke: lure.second, skill: s });
    }
  }

  // Buff "next" fica pendente até ser consumido pela próxima skill de DANO
  // (pula self-buffs e outras skills sem power, pra que o buff vá na skill forte)
  let buffPending = false;
  for (let i = 0; i < castSequence.length; i++) {
    const { poke, skill } = castSequence[i];
    const power = resolveSkillPower(skill, poke);
    const buffed = buffPending && power > 0;
    totalDmg += computeSkillDamage(cfg, poke, skill, mob, { buffedByPrevious: buffed, skillPower: power });
    if (buffed) buffPending = false;
    if (skill.buff === "next") buffPending = true;
  }

  return totalDmg;
}

/**
 * Retorna true se o lure finaliza a box (dmg_per_mob >= mob.hp).
 */
export function lureFinalizesBox(
  lure: Lure,
  cfg: DamageConfig,
  mob: MobConfig = cfg.mob
): boolean {
  return estimateLureDamagePerMob(lure, cfg, mob) >= mob.hp;
}

// =========================================================
// Pokemon element lookup (from roster ou dedução)
// =========================================================

/**
 * Retorna elementos de um poke. Primeiro tenta o roster (se passar), senão retorna vazio.
 * Útil pra ser injetado na geração de lures.
 */
export function getPokemonElements(
  poke: Pokemon,
  roster: { id: string; elements: PokemonElement[] }[]
): PokemonElement[] {
  return roster.find((p) => p.id === poke.id)?.elements ?? [];
}

/**
 * Soma o dano de TODAS as skills castadas em ordem ótima considerando buff_next.
 * Usado pra estimar dano solo de um poke com/sem device.
 */
export function estimatePokeSoloDamage(
  poke: Pokemon,
  orderedSkills: Skill[],
  config: DamageConfig,
  withDevice: boolean
): number {
  const setup = config.pokeSetups[poke.id];
  if (!setup) return 0;

  const setupOverride = { ...setup, hasDevice: withDevice };
  const cfgOverride: DamageConfig = {
    ...config,
    pokeSetups: { ...config.pokeSetups, [poke.id]: setupOverride },
  };

  let total = 0;
  let buffPending = false;
  for (let i = 0; i < orderedSkills.length; i++) {
    const skill = orderedSkills[i];
    const power = resolveSkillPower(skill, poke);
    const buffed = buffPending && power > 0;
    total += computeSkillDamage(cfgOverride, poke, skill, config.mob, {
      buffedByPrevious: buffed,
      skillPower: power,
    });
    if (buffed) buffPending = false;
    if (skill.buff === "next") buffPending = true;
  }
  return total;
}
