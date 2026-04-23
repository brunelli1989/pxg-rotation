import type { Pokemon, Skill, Tier } from "../../types";

// =========================================================
// Default skill_power por slot — fallback pra pokes não calibrados.
//
// Regra do jogo (validada em 60+ pokes calibrados): o budget de dano por slot
// é determinado por (role, tier, tem_CC_no_kit):
//   - offtank: flat ~18.5 entre tiers
//   - burst_dd: varia por tier e se tem CC (slot de CC "custa" budget de dano)
// =========================================================

type BurstKey = `${Tier}:${"CC" | "noCC"}`;
const BURST_POWER_BY_TIER_CC: Partial<Record<BurstKey, number>> = {
  "T1A:CC":   20.0, // placeholder — sem amostras
  "T1A:noCC": 20.0,
  "T1B:CC":   17.9, // n=1 (sh.pupitar per-skill 17.91 @ lvl 600 efetivo)
  "T1B:noCC": 17.9, // sem amostras — usa CC como proxy
  "T1H:CC":   24.6, // n=8
  "T1H:noCC": 24.6, // sem amostras — usa CC como proxy
  "T1C:CC":   22.0, // sem amostras — hierarquia TM > T1C > T2 (T2:CC=21.1)
  "T1C:noCC": 23.3, // n=2 (sh.ninetales 17.13 + crystal onix 29.43; alta variância)
  "T2:CC":    21.1, // n=11
  "T2:noCC":  22.2, // n=4
  "T3:CC":    19.0, // n=5
  "T3:noCC":  22.6, // n=5
  "TR:CC":    19.8, // n=5 (combinado CC+noCC; TR não distingue por amostra pequena)
  "TR:noCC":  19.8, // n=5 (mesmo valor)
  "TM:CC":    23.5, // sem amostras — hierarquia TM > T1C (T1C:CC=22.0)
  "TM:noCC":  24.5, // sem amostras — hierarquia TM > T1C (T1C:noCC=23.3)
};
const OFFTANK_POWER = 18.5;

function pokeHasCC(poke: Pokemon): boolean {
  return poke.skills.some((s) => s.cc === "stun" || s.cc === "silence" || s.cc === "locked");
}

export function getDefaultSkillPower(poke: Pokemon): number {
  if (!poke.role) return 0;
  if (poke.role === "offensive_tank") return OFFTANK_POWER;
  const key: BurstKey = `${poke.tier}:${pokeHasCC(poke) ? "CC" : "noCC"}`;
  return BURST_POWER_BY_TIER_CC[key] ?? 0;
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
  else result = getDefaultSkillPower(poke);
  bySkill.set(skill, result);
  return result;
}
