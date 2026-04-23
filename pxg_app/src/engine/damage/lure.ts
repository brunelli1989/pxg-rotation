import type { DamageConfig, Lure, MobConfig, Pokemon, PokemonElement, Skill } from "../../types";
import { resolveSkillPower } from "./fallback";
import { computeSkillDamage } from "./formula";

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

  // Elixir atk buffa +70% as skills de UM poke (o holder, tipicamente o mais forte) por 8s.
  // Assume janela do holder cabe nos 8s (5-skill cast ~= 5s). Null quando elixir não é usado.
  const elixirHolderId: string | null = lure.usesElixirAtk ? lure.elixirAtkHolderId : null;

  const castSequence: { poke: Pokemon; skill: Skill }[] = [];
  for (const s of lure.starterSkills) {
    castSequence.push({ poke: lure.starter, skill: s });
  }
  if (lure.second) {
    for (const s of lure.secondSkills) {
      castSequence.push({ poke: lure.second, skill: s });
    }
  }
  for (const m of lure.extraMembers) {
    for (const s of m.skills) {
      castSequence.push({ poke: m.poke, skill: s });
    }
  }

  // Revive: o poke target casta o kit de novo. Append segunda sequência ao cast sequence.
  // Buff next não "atravessa" o revive item (reset do kit = buff pendente também zera),
  // mas como segunda sequência tem buff-next no meio, o flag pendente é re-estabelecido.
  if (lure.reviveTier && lure.revivePokemonId) {
    const target: Pokemon | null =
      lure.starter.id === lure.revivePokemonId
        ? lure.starter
        : lure.second?.id === lure.revivePokemonId
          ? lure.second
          : (lure.extraMembers.find((m) => m.poke.id === lure.revivePokemonId)?.poke ?? null);
    const targetSkills: Skill[] =
      target === lure.starter
        ? lure.starterSkills
        : target === lure.second
          ? lure.secondSkills
          : (lure.extraMembers.find((m) => m.poke.id === lure.revivePokemonId)?.skills ?? []);
    if (target) {
      for (const s of targetSkills) castSequence.push({ poke: target, skill: s });
    }
  }

  // Buff "next" fica pendente até ser consumido pela próxima skill de DANO
  // (pula self-buffs e outras skills sem power, pra que o buff vá na skill forte)
  let buffPending = false;
  for (let i = 0; i < castSequence.length; i++) {
    const { poke, skill } = castSequence[i];
    const power = resolveSkillPower(skill, poke);
    const buffed = buffPending && power > 0;
    totalDmg += computeSkillDamage(cfg, poke, skill, mob, {
      buffedByPrevious: buffed,
      skillPower: power,
      elixirAtkActive: poke.id === elixirHolderId,
    });
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
  withDevice: boolean,
  elixirAtkActive = false
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
      elixirAtkActive,
    });
    if (buffed) buffPending = false;
    if (skill.buff === "next") buffPending = true;
  }
  return total;
}
