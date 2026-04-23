import type { DamageConfig, MobConfig, Pokemon, Skill, XAtkTier } from "../../types";
import { resolveSkillPower } from "./fallback";
import { DEFAULT_MOB_DEF_FACTOR } from "./mob";
import { computeEffectiveness, getClanBonus } from "./multipliers";

// =========================================================
// Constants (validated empirically, <0.2% precision cross-char)
// =========================================================

const BOOST_COEF = 1.3;
const FORMULA_CONSTANT = 150;
export const BUFF_NEXT_MULTIPLIER = 1.5; // +50% na próxima skill
export const ELIXIR_ATK_BONUS = 0.70; // +70% atk aditivo enquanto elixir atk está ativo

// =========================================================
// X-Atk / X-Boost held bonuses
// =========================================================

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
// Tabela da wiki: X = valor base por (tier, faixa). Wiki: "aumenta o bônus do Pokémon em X,
// concedendo bônus de vida equivalente a X níveis **e o dobro desse valor como bônus de ataque**".
// Pra damage calc, a contribuição efetiva ao boost é 2X (validado empiricamente em Sh.Rampardos
// + device X-Boost T7 @ lvl 366: observado 29,783/32,181 FR/RW → 2X model bate dentro de 0.5%).
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
  const base = X_BOOST_BY_RANGE[tier]?.[range] ?? 0;
  return base * 2;
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
  opts: { buffedByPrevious?: boolean; skillPower?: number; elixirAtkActive?: boolean } = {}
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
  const elixir = opts.elixirAtkActive ? ELIXIR_ATK_BONUS : 0;
  const helds = 1 + pokeAtk + deviceAtk + elixir;
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
