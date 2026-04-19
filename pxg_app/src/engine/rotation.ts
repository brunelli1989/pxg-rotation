import type {
  DamageConfig,
  DiskLevel,
  Lure,
  Pokemon,
  RotationResult,
  RotationStep,
} from "../types";
import {
  ELIXIR_ATK_COOLDOWN,
  ELIXIR_DEF_COOLDOWN,
  bagRate,
} from "./cooldown";
import { lureFinalizesBox } from "./damage";
import { getOptimalSkillOrder, hasFrontal, hasHardCC, hasHarden, hasSilence } from "./scoring";

const CAST_TIME = 1;
export const MAX_BAG = 6;

// =========================================================
// Utilities
// =========================================================

/**
 * Returns the minimum period P such that sequence[i] === sequence[i + P]
 * for all i (i.e., the sequence is a repetition of sequence.slice(0, P)).
 * Uses lure identity (starter.id + second?.id + type) for comparison.
 */
function lureKey(l: Lure): string {
  return `${l.type}:${l.starter.id}:${l.second?.id ?? ""}`;
}

function minPeriod(seq: Lure[]): number {
  const n = seq.length;
  for (let p = 1; p <= n; p++) {
    if (n % p !== 0) continue;
    let ok = true;
    for (let i = p; i < n; i++) {
      if (lureKey(seq[i]) !== lureKey(seq[i - p])) {
        ok = false;
        break;
      }
    }
    if (ok) return p;
  }
  return n;
}

export function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  if (arr.length === k) return [arr];

  const result: T[][] = [];
  for (let i = 0; i <= arr.length - k; i++) {
    const rest = arr.slice(i + 1);
    for (const combo of combinations(rest, k - 1)) {
      result.push([arr[i], ...combo]);
    }
  }
  return result;
}

// =========================================================
// Lure template generation
// =========================================================

export function generateLureTemplates(
  bag: Pokemon[],
  devicePokemonId: string | null
): Lure[] {
  const lures: Lure[] = [];
  const n = bag.length;

  // Flags cacheadas por índice da bag (evita chamar has*() centenas de vezes)
  const hardCC = new Array<boolean>(n);
  const harden = new Array<boolean>(n);
  const silence = new Array<boolean>(n);
  const frontal = new Array<boolean>(n);
  for (let i = 0; i < n; i++) {
    hardCC[i] = hasHardCC(bag[i]);
    harden[i] = hasHarden(bag[i]);
    silence[i] = hasSilence(bag[i]);
    frontal[i] = hasFrontal(bag[i]);
  }

  const deviceIdx = devicePokemonId
    ? bag.findIndex((p) => p.id === devicePokemonId)
    : -1;
  const devicePoke = deviceIdx >= 0 ? bag[deviceIdx] : null;

  // Solo T1H + device
  if (devicePoke && devicePoke.tier === "T1H" && hardCC[deviceIdx]) {
    lures.push({
      type: "solo_device",
      starter: devicePoke,
      second: null,
      starterSkills: getOptimalSkillOrder(devicePoke),
      secondSkills: [],
      starterUsesHarden: false,
      starterUsesElixirDef: false,
      usesElixirAtk: false,
      usesDevice: true,
          extraMembers: [],
    });
  }

  // Solo T2/T3/TR + elixir atk (starter must have CC, no frontal)
  for (let i = 0; i < n; i++) {
    if (i === deviceIdx) continue;
    const p = bag[i];
    if (p.tier === "T1H") continue;
    if (!hardCC[i]) continue;
    if (frontal[i]) continue;

    lures.push({
      type: "solo_elixir",
      starter: p,
      second: null,
      starterSkills: getOptimalSkillOrder(p),
      secondSkills: [],
      starterUsesHarden: harden[i],
      starterUsesElixirDef: !harden[i],
      usesElixirAtk: true,
      usesDevice: false,
          extraMembers: [],
    });
  }

  // Dupla: starter (com CC) + second (qualquer outro). Matriz de validade pré-computada.
  for (let i = 0; i < n; i++) {
    if (!hardCC[i] || i === deviceIdx) continue;
    const starter = bag[i];
    const starterHarden = harden[i];

    for (let j = 0; j < n; j++) {
      if (j === i || j === deviceIdx) continue;
      // silence + frontal cruzados invalidam a dupla (mesmo que não fosse usar)
      const silenceActive = silence[i] || silence[j];
      if (silenceActive && (frontal[i] || frontal[j])) continue;

      const second = bag[j];
      lures.push({
        type: "dupla",
        starter,
        second,
        starterSkills: getOptimalSkillOrder(starter, silenceActive),
        secondSkills: getOptimalSkillOrder(second, silenceActive),
        starterUsesHarden: starterHarden,
        starterUsesElixirDef: !starterHarden,
        usesElixirAtk: false,
        usesDevice: false,
          extraMembers: [],
      });
    }
  }

  return lures;
}

// =========================================================
// Simulation state
// =========================================================

interface SkillCastInfo {
  castTime: number;
  baseCD: number;
  selfCastSnapshot: number;  // selfCastTotal at cast time
  othersCastSnapshot: number; // othersCastTotal at cast time
}

export interface SimState {
  clock: number;
  skillCasts: Map<string, SkillCastInfo>;
  // Time poke spent actively casting its own skills
  selfCastTotal: Map<string, number>;
  // Time poke spent in bag while another poke was actively casting
  othersCastTotal: Map<string, number>;
  elixirAtkReady: number;
  elixirDefReady: number;
  totalIdle: number;
  steps: RotationStep[];
  // Used to increment othersCastTotal for other pokes in the bag
  bag: string[];
}

function cloneState(s: SimState): SimState {
  return {
    clock: s.clock,
    skillCasts: new Map(s.skillCasts),
    selfCastTotal: new Map(s.selfCastTotal),
    othersCastTotal: new Map(s.othersCastTotal),
    elixirAtkReady: s.elixirAtkReady,
    elixirDefReady: s.elixirDefReady,
    totalIdle: s.totalIdle,
    steps: s.steps.slice(),
    bag: s.bag,
  };
}

export function emptyState(bag: string[] = []): SimState {
  return {
    clock: 0,
    skillCasts: new Map(),
    selfCastTotal: new Map(),
    othersCastTotal: new Map(),
    elixirAtkReady: 0,
    elixirDefReady: 0,
    totalIdle: 0,
    steps: [],
    bag,
  };
}

const KILL_TIME = 10; // seconds of kill time after each lure's finisher (all pokes in bag, disk still applies)

/**
 * Increments bagTotal (time in bag) for all pokes except the excludeId.
 * Disk recovery applies to all bag time.
 */
function tickBagTime(state: SimState, excludeId: string | null, seconds: number) {
  for (const id of state.bag) {
    if (id === excludeId) continue;
    const prev = state.othersCastTotal.get(id) ?? 0;
    state.othersCastTotal.set(id, prev + seconds);
  }
}

/**
 * Computes the wait needed for a starter skill (cast at lure_start + offset).
 * During wait, we assume the starter is "selected-idle" → self-cast progresses at 1:1
 * for the starter, but no one else is casting (so others_cast doesn't increment).
 *
 * Model:
 *   Recovery = selfCast × 1 + othersCast × (1/diskMult)
 *   Ready when recovery >= baseCD
 *
 * For starter's skill i cast at lure_start + (i+1):
 *   - Past selfCast: selfCastTotal[starter] - skillCast.selfCastSnapshot
 *   - Wait contributes selfCast += wait (starter "active-idle")
 *   - Lure start to cast: starter casts (i+1) of its skills → selfCast += (i+1)
 *   - Past othersCast: othersCastTotal[starter] - skillCast.othersCastSnapshot
 *   - Wait does NOT contribute to othersCast (no one else casting)
 *
 * Recovery >= baseCD:
 *   (selfPast + wait + (i+1)) + othersPast × (1/mult) >= baseCD
 *   wait >= baseCD - selfPast - (i+1) - othersPast × (1/mult)
 */
function waitForStarterSkill(
  state: SimState,
  pokeId: string,
  skillKey: string,
  offset: number,
  rate: number
): number {
  const info = state.skillCasts.get(skillKey);
  if (!info) return 0;

  const selfPast = (state.selfCastTotal.get(pokeId) ?? 0) - info.selfCastSnapshot;
  const othersPast = (state.othersCastTotal.get(pokeId) ?? 0) - info.othersCastSnapshot;

  const required = info.baseCD - selfPast - offset - othersPast * rate;
  return Math.max(0, required);
}

/**
 * Required wait for a SECOND's skill to be ready.
 * During wait, second is in bag (gains bag time at disk rate).
 * During starter's cast, second is also in bag (num_starter seconds of bag time).
 * During second's own casts, second gains self-cast at 1:1.
 *
 * Recovery >= baseCD:
 *   (selfPast + j+1) + (othersPast + W + num_starter) × rate >= baseCD
 *   W × rate >= baseCD - selfPast - (j+1) - (othersPast + num_starter) × rate
 *   W >= (baseCD - selfPast - (j+1)) / rate - (othersPast + num_starter)
 */
function waitForSecondSkill(
  state: SimState,
  pokeId: string,
  skillKey: string,
  offsetWithinSecondCast: number,
  numStarterCasts: number,
  rate: number
): number {
  const info = state.skillCasts.get(skillKey);
  if (!info) return 0;

  const selfPast = (state.selfCastTotal.get(pokeId) ?? 0) - info.selfCastSnapshot;
  const othersPast = (state.othersCastTotal.get(pokeId) ?? 0) - info.othersCastSnapshot;

  const required =
    (info.baseCD - selfPast - offsetWithinSecondCast) / rate - (othersPast + numStarterCasts);
  return Math.max(0, required);
}

const INFEASIBLE = Number.POSITIVE_INFINITY;

export function applyLure(
  state: SimState,
  lure: Lure,
  diskLevel: DiskLevel
): RotationStep {
  const stepStart = state.clock;
  const rate = bagRate(diskLevel);
  const numStarterSkills = lure.starterSkills.length;

  // Compute wait needed for all skills (starter + second)
  // Wait = max over all required waits
  let wait = 0;

  // Starter's skills: during wait, starter is active-idle (selfCast += W)
  for (let i = 0; i < numStarterSkills; i++) {
    const key = `${lure.starter.id}:${lure.starterSkills[i].name}`;
    const w = waitForStarterSkill(state, lure.starter.id, key, i + 1, rate);
    if (w > wait) wait = w;
  }

  // Second's skills: during wait, second is in bag (others_cast += W at bag rate)
  if (lure.type === "dupla" && lure.second) {
    for (let j = 0; j < lure.secondSkills.length; j++) {
      const key = `${lure.second.id}:${lure.secondSkills[j].name}`;
      const w = waitForSecondSkill(state, lure.second.id, key, j + 1, numStarterSkills, rate);
      if (w > wait) wait = w;
    }
  }

  // Step 3: Check elixir atk / def
  if (lure.usesElixirAtk) {
    const totalCasts = numStarterSkills + lure.secondSkills.length + 1;
    const elixirCastAt = state.clock + wait + totalCasts;
    const elixirWait = state.elixirAtkReady - elixirCastAt;
    if (elixirWait > 0) wait += elixirWait;
  }
  if (lure.starterUsesElixirDef) {
    const defWait = state.elixirDefReady - (state.clock + wait);
    if (defWait > 0) wait += defWait;
  }

  // Step 4: Advance clock by wait. During wait:
  //   - Starter is "selected-idle" → self-cast progresses 1:1
  //   - Others in bag → disk rate applies (bag time)
  if (wait > 0) {
    const prevSelf = state.selfCastTotal.get(lure.starter.id) ?? 0;
    state.selfCastTotal.set(lure.starter.id, prevSelf + wait);
    tickBagTime(state, lure.starter.id, wait);
    state.clock += wait;
    state.totalIdle += wait;
  }

  // Consume elixir def at lure start
  if (lure.starterUsesElixirDef) {
    state.elixirDefReady = state.clock + ELIXIR_DEF_COOLDOWN;
  }

  // Step 5: Cast starter skills. Each cast: starter self-casts 1s, all others in bag get bag time += 1
  for (let i = 0; i < numStarterSkills; i++) {
    state.clock += CAST_TIME;
    const prevSelf = state.selfCastTotal.get(lure.starter.id) ?? 0;
    state.selfCastTotal.set(lure.starter.id, prevSelf + CAST_TIME);
    tickBagTime(state, lure.starter.id, CAST_TIME);

    const key = `${lure.starter.id}:${lure.starterSkills[i].name}`;
    state.skillCasts.set(key, {
      castTime: state.clock,
      baseCD: lure.starterSkills[i].cooldown,
      selfCastSnapshot: state.selfCastTotal.get(lure.starter.id) ?? 0,
      othersCastSnapshot: state.othersCastTotal.get(lure.starter.id) ?? 0,
    });
  }

  // Step 6: Cast second skills (dupla)
  if (lure.type === "dupla" && lure.second) {
    for (let j = 0; j < lure.secondSkills.length; j++) {
      state.clock += CAST_TIME;
      const prevSelf = state.selfCastTotal.get(lure.second.id) ?? 0;
      state.selfCastTotal.set(lure.second.id, prevSelf + CAST_TIME);
      tickBagTime(state, lure.second.id, CAST_TIME);

      const key = `${lure.second.id}:${lure.secondSkills[j].name}`;
      state.skillCasts.set(key, {
        castTime: state.clock,
        baseCD: lure.secondSkills[j].cooldown,
        selfCastSnapshot: state.selfCastTotal.get(lure.second.id) ?? 0,
        othersCastSnapshot: state.othersCastTotal.get(lure.second.id) ?? 0,
      });
    }
  }

  // Step 7: Finisher cast (device or elixir atk)
  if (lure.usesDevice) {
    state.clock += CAST_TIME;
    const prevSelf = state.selfCastTotal.get(lure.starter.id) ?? 0;
    state.selfCastTotal.set(lure.starter.id, prevSelf + CAST_TIME);
    tickBagTime(state, lure.starter.id, CAST_TIME);
  } else if (lure.usesElixirAtk) {
    state.clock += CAST_TIME;
    const prevSelf = state.selfCastTotal.get(lure.starter.id) ?? 0;
    state.selfCastTotal.set(lure.starter.id, prevSelf + CAST_TIME);
    tickBagTime(state, lure.starter.id, CAST_TIME);
    state.elixirAtkReady = state.clock + ELIXIR_ATK_COOLDOWN;
  }

  const step: RotationStep = {
    lure,
    timeStart: stepStart,
    timeEnd: state.clock,
    idleBefore: wait,
    idleMidLure: 0,
  };
  state.steps.push(step);

  // Kill time: 10s after each lure's finisher. All pokes in bag, disk applies.
  tickBagTime(state, null, KILL_TIME);
  state.clock += KILL_TIME;

  return step;
}

export { INFEASIBLE };

// =========================================================
// Beam search
// =========================================================

interface BeamState {
  sim: SimState;
  sequence: Lure[]; // just for tracking
}

/**
 * Runs beam search to find the best rotation sequence.
 * For each cycle length, simulates 2 cycles and measures steady-state idle.
 */
export function findBestRotation(
  bag: Pokemon[],
  diskLevel: DiskLevel,
  devicePokemonId: string | null,
  options: {
    beamWidth?: number;
    maxCycleLen?: number;
    minCycleLen?: number;
    damageConfig?: DamageConfig;
  } = {}
): { idle: number; result: RotationResult } | null {
  const beamWidth = options.beamWidth ?? 120;
  const maxCycleLen = options.maxCycleLen ?? 12;
  const minCycleLen = options.minCycleLen ?? 2;

  let lures = generateLureTemplates(bag, devicePokemonId);
  if (options.damageConfig) {
    const cfg = options.damageConfig;
    lures = lures.filter((lure) => lureFinalizesBox(lure, cfg, cfg.mob));
  }
  if (lures.length === 0) return null;

  const bagIds = bag.map((p) => p.id);

  let beam: BeamState[] = lures.map((lure) => {
    const sim = emptyState(bagIds);
    applyLure(sim, lure, diskLevel);
    return { sim, sequence: [lure] };
  });

  let bestOverall: { idle: number; result: RotationResult; score: number } | null = null;

  for (let step = 1; step < maxCycleLen; step++) {
    const candidates: BeamState[] = [];
    for (const state of beam) {
      for (const lure of lures) {
        const newSim = cloneState(state.sim);
        applyLure(newSim, lure, diskLevel);
        candidates.push({
          sim: newSim,
          sequence: [...state.sequence, lure],
        });
      }
    }

    const scored = candidates.map((cand) => {
      const period = minPeriod(cand.sequence);
      const truePeriodSeq = cand.sequence.slice(0, period);
      const ev = evaluateCycle(truePeriodSeq, diskLevel, bagIds);
      const timePerLure = ev.result.totalTime / truePeriodSeq.length;
      return { cand, ev, score: timePerLure };
    });

    scored.sort((a, b) => a.score - b.score);
    beam = scored.slice(0, beamWidth).map((s) => s.cand);

    // Track best overall (minimum time per lure)
    if (step + 1 >= minCycleLen) {
      const best = scored[0];
      if (!bestOverall || best.score < bestOverall.score) {
        bestOverall = {
          idle: best.ev.idlePerCycle,
          result: best.ev.result,
          score: best.score,
        };
      }
    }
  }

  if (!bestOverall) return null;
  return { idle: bestOverall.idle, result: bestOverall.result };
}

/**
 * Evaluates a cycle by running it twice back-to-back and measuring
 * idle time in the second cycle. Returns null if any lure is infeasible.
 */
function evaluateCycle(
  cycle: Lure[],
  diskLevel: DiskLevel,
  bagIds: string[]
): { idlePerCycle: number; result: RotationResult } {
  const sim = emptyState(bagIds);

  // Cycle 1: warmup
  for (const lure of cycle) {
    applyLure(sim, lure, diskLevel);
  }

  // Cycle 2: measure
  const cycle2Start = sim.clock;
  const cycle2IdleStart = sim.totalIdle;
  const cycle2StepsStart = sim.steps.length;

  for (const lure of cycle) {
    applyLure(sim, lure, diskLevel);
  }

  const cycle2End = sim.clock;
  const cycle2Idle = sim.totalIdle - cycle2IdleStart;
  const cycle2Steps = sim.steps
    .slice(cycle2StepsStart)
    .map((s) => ({
      ...s,
      timeStart: s.timeStart - cycle2Start,
      timeEnd: s.timeEnd - cycle2Start,
    }));

  const selectedIds = Array.from(
    new Set(
      cycle.flatMap((l) => [l.starter.id, l.second?.id].filter(Boolean) as string[])
    )
  );

  return {
    idlePerCycle: cycle2Idle,
    result: {
      steps: cycle2Steps,
      totalTime: cycle2End - cycle2Start,
      totalIdle: cycle2Idle,
      cycleNumber: 2,
      selectedIds,
      devicePokemonId: cycle.some((l) => l.usesDevice)
        ? cycle.find((l) => l.usesDevice)!.starter.id
        : null,
    },
  };
}

// =========================================================
// Device & combo brute force + beam search
// =========================================================

/**
 * For a given bag, tries each T1H with CC as device holder (and also no device).
 * Returns best rotation across all device options.
 */
export function findBestForBag(
  bag: Pokemon[],
  diskLevel: DiskLevel,
  options?: {
    beamWidth?: number;
    maxCycleLen?: number;
    minCycleLen?: number;
    damageConfig?: DamageConfig;
  }
): { idle: number; result: RotationResult } | null {
  // Device: só T1H+CC carrega device. Limita a top-2 por power total calibrado
  // pra evitar explosão de runs em bags com muitos T1H.
  const t1hCC = bag
    .filter((p) => p.tier === "T1H" && hasHardCC(p))
    .map((p) => ({
      id: p.id,
      score: p.skills.reduce((s, sk) => s + (sk.power ?? 0), 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.id);
  const deviceCandidates: (string | null)[] = [null, ...t1hCC];

  let best: { idle: number; result: RotationResult } | null = null;
  let bestScore = Infinity;
  for (const deviceId of deviceCandidates) {
    const res = findBestRotation(bag, diskLevel, deviceId, options);
    if (res) {
      const score = res.result.totalTime / res.result.steps.length;
      if (score < bestScore) {
        bestScore = score;
        best = res;
      }
    }
  }
  return best;
}
