import type { DamageConfig, DiskLevel, Pokemon, RotationResult } from "../types";
import { findBestForBag } from "./rotation";
import { estimatePokeSoloDamage } from "./damage";
import { getOptimalSkillOrder, hasHardCC, hasHarden } from "./scoring";
import { ELIXIR_DEF_COOLDOWN } from "./cooldown";

export interface WorkerRequest {
  bags: Pokemon[][];
  diskLevel: DiskLevel;
  beamWidth?: number;
  maxCycleLen?: number;
  minCycleLen?: number;
  damageConfig?: DamageConfig;
}

export type WorkerMessage =
  | { type: "progress"; done: number }
  | {
      type: "result";
      bestIdle: number;
      bestResult: RotationResult | null;
    };

const MIN_ACTIVE_TIME = 20; // ~10s casts + 10s kill time

/**
 * Lower bound para time-per-lure de uma bag. Usado pra pular bags que não
 * podem bater o best-so-far ANTES de rodar o beam search.
 *
 * Pra cada starter válido p, o bound é `max(maxSkillCD, defPenalty)`:
 * - Rotação single-poke: T ≥ maxSkillCD (skill precisa recuperar entre casts).
 *   Rotação multi-poke alterna, pode ir abaixo do maxSkillCD — então pegamos
 *   `min` sobre todos os starters válidos (optimistic: melhor starter define bound).
 * - defPenalty = ELIXIR_DEF_COOLDOWN (210s) se o starter não tem defesa barata
 *   (Harden/Intimidate/etc ou T1H com device).
 */
function bagTimePerLureLowerBound(bag: Pokemon[]): number {
  let bestBound = Infinity;
  let hasValidStarter = false;
  for (const p of bag) {
    if (!hasHardCC(p)) continue;
    hasValidStarter = true;

    let maxSkillCD = 0;
    for (const s of p.skills) if (s.cooldown > maxSkillCD) maxSkillCD = s.cooldown;

    const hasCheapDef = p.tier === "T1H" || hasHarden(p);
    const defPenalty = hasCheapDef ? 0 : ELIXIR_DEF_COOLDOWN;

    const pokeBound = Math.max(maxSkillCD, defPenalty, MIN_ACTIVE_TIME);
    if (pokeBound < bestBound) bestBound = pokeBound;
  }
  if (!hasValidStarter) return Infinity;
  return bestBound;
}

/**
 * Upper bound de dano por mob somando TODOS os pokes da bag com device+elixir.
 * É um bound solto (superestima: apenas 1 poke usa device e 1 usa elixir de fato).
 * Se esse máximo < HP_mob, nenhuma combinação finaliza a box → pula antes do beam.
 * Memoizado por poke.id pois mesmo poke aparece em muitas bags.
 */
function makeBagDamagePruner(damageConfig: DamageConfig) {
  const perPokeDmg = new Map<string, number>();
  const getDmg = (p: Pokemon): number => {
    let d = perPokeDmg.get(p.id);
    if (d === undefined) {
      d = estimatePokeSoloDamage(p, getOptimalSkillOrder(p), damageConfig, true, true);
      perPokeDmg.set(p.id, d);
    }
    return d;
  };
  const hp = damageConfig.mob.hp;
  return (bag: Pokemon[]): boolean => {
    let total = 0;
    for (const p of bag) total += getDmg(p);
    return total < hp;
  };
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { bags, diskLevel, beamWidth, maxCycleLen, minCycleLen, damageConfig } = e.data;

  let bestIdle = Infinity;
  let bestTimePerLure = Infinity;
  let bestResult: RotationResult | null = null;

  let skippedTime = 0;
  let skippedDmg = 0;

  // Pré-filter por dano: bags que não batem o HP_mob nem com device+elixir são descartadas.
  const cantFinalize = damageConfig ? makeBagDamagePruner(damageConfig) : null;

  // Sort bags by lower bound (menor = potencialmente melhor). Rodar bags mais promissoras
  // primeiro acelera o pruning: bestTimePerLure desce rápido, demais bags são puladas.
  const bagsWithBound = bags.map((bag) => ({ bag, bound: bagTimePerLureLowerBound(bag) }));
  bagsWithBound.sort((a, b) => a.bound - b.bound);

  for (const { bag, bound } of bagsWithBound) {
    // Pruning por tempo: lower bound >= best já achado
    if (bound >= bestTimePerLure) {
      skippedTime++;
      const progressMsg: WorkerMessage = { type: "progress", done: 1 };
      self.postMessage(progressMsg);
      continue;
    }
    // Pruning por dano: upper bound < HP_mob (impossível finalizar)
    if (cantFinalize && cantFinalize(bag)) {
      skippedDmg++;
      const progressMsg: WorkerMessage = { type: "progress", done: 1 };
      self.postMessage(progressMsg);
      continue;
    }

    const res = findBestForBag(bag, diskLevel, {
      beamWidth,
      maxCycleLen,
      minCycleLen,
      damageConfig,
    });
    if (res) {
      // res.score já inclui starterResistFactor (preferência por starters resistentes).
      if (res.score < bestTimePerLure) {
        bestTimePerLure = res.score;
        bestIdle = res.idle;
        bestResult = res.result;
      }
    }
    const progressMsg: WorkerMessage = { type: "progress", done: 1 };
    self.postMessage(progressMsg);
  }

  if (skippedTime + skippedDmg > 0) {
    console.log(
      `[worker] skipped ${skippedTime + skippedDmg}/${bags.length} bags ` +
      `(time=${skippedTime}, dmg=${skippedDmg})`
    );
  }

  const done: WorkerMessage = { type: "result", bestIdle, bestResult };
  self.postMessage(done);
};
