// Barrel re-export do módulo damage refatorado em submódulos.
// Código dividido em 5 arquivos sob ./damage/:
//   - fallback.ts    → skill_power fallback (BURST_POWER_BY_TIER_CC, resolveSkillPower)
//   - mob.ts         → mob hp/defFactor resolver (resolveMobConfig)
//   - multipliers.ts → TYPE_CHART + CLAN_ATK_BONUS (eff + clã)
//   - formula.ts     → X-Atk/X-Boost tables + computeSkillDamage + deriveSkillPower
//   - lure.ts        → estimateLureDamagePerMob/lureFinalizesBox/estimatePokeSoloDamage
export { getDefaultSkillPower, resolveSkillPower } from "./damage/fallback";
export { DEFAULT_MOB_DEF_FACTOR, resolveMobConfig } from "./damage/mob";
export type { MobFieldSource, ResolvedMob } from "./damage/mob";
export {
  computeEffectiveness,
  getClanBonus,
  getClanElements,
  getEffectiveness,
} from "./damage/multipliers";
export {
  BUFF_NEXT_MULTIPLIER,
  ELIXIR_ATK_BONUS,
  MAX_X_BOOST_TIER,
  computeSkillDamage,
  deriveSkillPower,
} from "./damage/formula";
export {
  estimateLureDamagePerMob,
  estimatePokeSoloDamage,
  getPokemonElements,
  lureFinalizesBox,
} from "./damage/lure";
