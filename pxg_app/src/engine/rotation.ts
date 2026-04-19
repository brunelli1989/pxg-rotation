import type {
  DamageConfig,
  DiskLevel,
  Lure,
  LureMember,
  Pokemon,
  RotationResult,
  RotationStep,
} from "../types";
import {
  ELIXIR_ATK_COOLDOWN,
  ELIXIR_DEF_COOLDOWN,
  bagRate,
} from "./cooldown";
import { lureFinalizesBox, resolveSkillPower } from "./damage";
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
  const extras = l.extraMembers.length
    ? ":" + l.extraMembers.map((m) => m.poke.id).sort().join(",")
    : "";
  const elixir = l.usesElixirAtk ? ":elixir" : "";
  return `${l.type}:${l.starter.id}:${l.second?.id ?? ""}${extras}${elixir}`;
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

/**
 * Elixir atk vai no poke mais forte do lure (sum de skill_power calibrado/fallback).
 * Heurística: skills area somam mais dano efetivo; frontais pesam igual pro ranking
 * (o usuário ainda consegue colocar elixir em offtank T1H se ele aparecer).
 */
function pickElixirHolder(members: Pokemon[]): Pokemon {
  let best = members[0];
  let bestScore = -1;
  for (const p of members) {
    const score = p.skills.reduce((s, sk) => s + resolveSkillPower(sk, p), 0);
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
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
  devicePokemonId: string | null,
  options: { includeDuplaElixir?: boolean; includeGroup?: boolean } = {}
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
      elixirAtkHolderId: null,
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
      elixirAtkHolderId: p.id,
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
      const baseDupla = {
        type: "dupla" as const,
        starter,
        second,
        starterSkills: getOptimalSkillOrder(starter, silenceActive),
        secondSkills: getOptimalSkillOrder(second, silenceActive),
        starterUsesHarden: starterHarden,
        starterUsesElixirDef: !starterHarden,
        usesDevice: false,
        extraMembers: [],
      };
      lures.push({ ...baseDupla, usesElixirAtk: false, elixirAtkHolderId: null });
      // Dupla + elixir atk: útil em hunt 400+ quando a dupla raw não finaliza a box.
      if (options.includeDuplaElixir) {
        const holder = pickElixirHolder([starter, second]);
        lures.push({ ...baseDupla, usesElixirAtk: true, elixirAtkHolderId: holder.id });
      }
    }
  }

  // Group lures: starter (com CC) + 2..5 extras (total 3..6 membros). Gerados apenas quando
  // caller aceita (cascading fallback quando nenhuma dupla/dupla+elixir finaliza).
  // Em hunt 400+ com held baixo, a bag inteira (6 membros) pode ser necessária.
  const MAX_GROUP_EXTRAS = MAX_BAG - 1;
  if (options.includeGroup) {
    for (let i = 0; i < n; i++) {
      if (!hardCC[i] || i === deviceIdx) continue;
      const starter = bag[i];
      const starterHarden = harden[i];

      const candidateIdx: number[] = [];
      for (let k = 0; k < n; k++) {
        if (k !== i && k !== deviceIdx) candidateIdx.push(k);
      }

      const maxExtras = Math.min(candidateIdx.length, MAX_GROUP_EXTRAS);
      for (let extraCount = 2; extraCount <= maxExtras; extraCount++) {
        for (const combo of combinations(candidateIdx, extraCount)) {
          const silenceActive = silence[i] || combo.some((k) => silence[k]);
          const frontalAny = frontal[i] || combo.some((k) => frontal[k]);
          if (silenceActive && frontalAny) continue;

          const second = bag[combo[0]];
          const rest = combo.slice(1).map<LureMember>((k) => ({
            poke: bag[k],
            skills: getOptimalSkillOrder(bag[k], silenceActive),
          }));

          const base = {
            type: "group" as const,
            starter,
            second,
            starterSkills: getOptimalSkillOrder(starter, silenceActive),
            secondSkills: getOptimalSkillOrder(second, silenceActive),
            starterUsesHarden: starterHarden,
            starterUsesElixirDef: !starterHarden,
            usesDevice: false,
            extraMembers: rest,
          };
          lures.push({ ...base, usesElixirAtk: false, elixirAtkHolderId: null });
          const holder = pickElixirHolder([starter, second, ...rest.map((m) => m.poke)]);
          lures.push({ ...base, usesElixirAtk: true, elixirAtkHolderId: holder.id });
        }
      }
    }
  }

  return lures;
}

// =========================================================
// Simulation state (typed-array layout pra minimizar custo de clone no beam search)
// =========================================================

// Upper bound de skills por poke. Pokes calibrados têm até 6 hoje.
const MAX_SKILLS_PER_POKE = 8;

/**
 * Contexto estático de uma bag: mapeamentos de id → índice. Nunca clonado durante
 * o beam search — passado por referência pras funções de simulação.
 */
export interface SimContext {
  bag: string[];                        // bagIds ordenados
  n: number;                            // bag.length
  pokeIdx: Map<string, number>;         // pokeId → bag index (0..n-1)
  skillSlotByKey: Map<string, number>;  // "pokeId:skillName" → slot (0..n*MAX_SKILLS)
  skillSlotCount: number;               // n * MAX_SKILLS_PER_POKE
}

export function buildSimContext(bag: Pokemon[]): SimContext {
  const n = bag.length;
  const bagIds: string[] = new Array(n);
  const pokeIdx = new Map<string, number>();
  const skillSlotByKey = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const p = bag[i];
    bagIds[i] = p.id;
    pokeIdx.set(p.id, i);
    const base = i * MAX_SKILLS_PER_POKE;
    for (let j = 0; j < p.skills.length; j++) {
      skillSlotByKey.set(`${p.id}:${p.skills[j].name}`, base + j);
    }
  }
  return { bag: bagIds, n, pokeIdx, skillSlotByKey, skillSlotCount: n * MAX_SKILLS_PER_POKE };
}

/**
 * State mutável da simulação. Usa typed arrays pra clone rápido via memcpy
 * (new Float64Array(other)) em vez de new Map(old) que aloca buckets.
 */
export interface SimState {
  clock: number;
  // Skill cast tracking: 4 parallel arrays indexed por slot (pokeIdx * MAX_SKILLS + skillIdx).
  // skillCastTime[slot] = -1 quando a skill nunca foi castada.
  skillCastTime: Float64Array;
  skillBaseCD: Float64Array;
  skillSelfSnap: Float64Array;
  skillOthersSnap: Float64Array;
  // Per-poke counters indexed por bag index.
  selfCastTotal: Float64Array;
  othersCastTotal: Float64Array;
  elixirAtkReady: number;
  elixirDefReady: number;
  totalIdle: number;
  steps: RotationStep[];
}

function cloneState(s: SimState): SimState {
  return {
    clock: s.clock,
    skillCastTime: new Float64Array(s.skillCastTime),
    skillBaseCD: new Float64Array(s.skillBaseCD),
    skillSelfSnap: new Float64Array(s.skillSelfSnap),
    skillOthersSnap: new Float64Array(s.skillOthersSnap),
    selfCastTotal: new Float64Array(s.selfCastTotal),
    othersCastTotal: new Float64Array(s.othersCastTotal),
    elixirAtkReady: s.elixirAtkReady,
    elixirDefReady: s.elixirDefReady,
    totalIdle: s.totalIdle,
    steps: s.steps.slice(),
  };
}

export function emptyState(ctx: SimContext): SimState {
  const castTimes = new Float64Array(ctx.skillSlotCount);
  castTimes.fill(-1); // sentinel "nunca castado"
  return {
    clock: 0,
    skillCastTime: castTimes,
    skillBaseCD: new Float64Array(ctx.skillSlotCount),
    skillSelfSnap: new Float64Array(ctx.skillSlotCount),
    skillOthersSnap: new Float64Array(ctx.skillSlotCount),
    selfCastTotal: new Float64Array(ctx.n),
    othersCastTotal: new Float64Array(ctx.n),
    elixirAtkReady: 0,
    elixirDefReady: 0,
    totalIdle: 0,
    steps: [],
  };
}

const KILL_TIME = 10; // seconds of kill time after each lure's finisher (all pokes in bag, disk still applies)

/**
 * Incrementa othersCastTotal pra todos os pokes da bag exceto excludeIdx.
 * Passa -1 pra incluir todos (kill time).
 */
function tickBagTime(state: SimState, ctx: SimContext, excludeIdx: number, seconds: number) {
  const arr = state.othersCastTotal;
  for (let i = 0; i < ctx.n; i++) {
    if (i === excludeIdx) continue;
    arr[i] += seconds;
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
  pokeIdx: number,
  slot: number,
  offset: number,
  rate: number
): number {
  if (state.skillCastTime[slot] < 0) return 0;

  const selfPast = state.selfCastTotal[pokeIdx] - state.skillSelfSnap[slot];
  const othersPast = state.othersCastTotal[pokeIdx] - state.skillOthersSnap[slot];

  const required = state.skillBaseCD[slot] - selfPast - offset - othersPast * rate;
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
  pokeIdx: number,
  slot: number,
  offsetWithinOwnCast: number,
  offsetBeforeOwnCast: number,
  rate: number
): number {
  if (state.skillCastTime[slot] < 0) return 0;

  const selfPast = state.selfCastTotal[pokeIdx] - state.skillSelfSnap[slot];
  const othersPast = state.othersCastTotal[pokeIdx] - state.skillOthersSnap[slot];

  const required =
    (state.skillBaseCD[slot] - selfPast - offsetWithinOwnCast) / rate - (othersPast + offsetBeforeOwnCast);
  return Math.max(0, required);
}

const INFEASIBLE = Number.POSITIVE_INFINITY;

export function applyLure(
  state: SimState,
  ctx: SimContext,
  lure: Lure,
  diskLevel: DiskLevel
): RotationStep {
  const stepStart = state.clock;
  const rate = bagRate(diskLevel);
  const numStarterSkills = lure.starterSkills.length;
  const starterIdx = ctx.pokeIdx.get(lure.starter.id)!;

  // Compute wait needed for all skills (starter + second + extras). Wait = max over all required.
  let wait = 0;

  for (let i = 0; i < numStarterSkills; i++) {
    const slot = ctx.skillSlotByKey.get(`${lure.starter.id}:${lure.starterSkills[i].name}`)!;
    const w = waitForStarterSkill(state, starterIdx, slot, i + 1, rate);
    if (w > wait) wait = w;
  }

  let secondIdx = -1;
  if (lure.second) {
    secondIdx = ctx.pokeIdx.get(lure.second.id)!;
    for (let j = 0; j < lure.secondSkills.length; j++) {
      const slot = ctx.skillSlotByKey.get(`${lure.second.id}:${lure.secondSkills[j].name}`)!;
      const w = waitForSecondSkill(state, secondIdx, slot, j + 1, numStarterSkills, rate);
      if (w > wait) wait = w;
    }
  }

  // Group: extraMembers cast after starter + second. Each extra has offsetBefore = all
  // casts before it starts (starter + second + prior extras).
  let offsetBeforeExtra = numStarterSkills + lure.secondSkills.length;
  for (const m of lure.extraMembers) {
    const memberIdx = ctx.pokeIdx.get(m.poke.id)!;
    for (let j = 0; j < m.skills.length; j++) {
      const slot = ctx.skillSlotByKey.get(`${m.poke.id}:${m.skills[j].name}`)!;
      const w = waitForSecondSkill(state, memberIdx, slot, j + 1, offsetBeforeExtra, rate);
      if (w > wait) wait = w;
    }
    offsetBeforeExtra += m.skills.length;
  }

  // Step 3: Check elixir atk / def
  if (lure.usesElixirAtk) {
    const extraSkillCount = lure.extraMembers.reduce((s, m) => s + m.skills.length, 0);
    const totalCasts = numStarterSkills + lure.secondSkills.length + extraSkillCount + 1;
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
    state.selfCastTotal[starterIdx] += wait;
    tickBagTime(state, ctx, starterIdx, wait);
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
    state.selfCastTotal[starterIdx] += CAST_TIME;
    tickBagTime(state, ctx, starterIdx, CAST_TIME);

    const slot = ctx.skillSlotByKey.get(`${lure.starter.id}:${lure.starterSkills[i].name}`)!;
    state.skillCastTime[slot] = state.clock;
    state.skillBaseCD[slot] = lure.starterSkills[i].cooldown;
    state.skillSelfSnap[slot] = state.selfCastTotal[starterIdx];
    state.skillOthersSnap[slot] = state.othersCastTotal[starterIdx];
  }

  // Step 6: Cast second skills (dupla + group)
  if (lure.second && secondIdx >= 0) {
    for (let j = 0; j < lure.secondSkills.length; j++) {
      state.clock += CAST_TIME;
      state.selfCastTotal[secondIdx] += CAST_TIME;
      tickBagTime(state, ctx, secondIdx, CAST_TIME);

      const slot = ctx.skillSlotByKey.get(`${lure.second.id}:${lure.secondSkills[j].name}`)!;
      state.skillCastTime[slot] = state.clock;
      state.skillBaseCD[slot] = lure.secondSkills[j].cooldown;
      state.skillSelfSnap[slot] = state.selfCastTotal[secondIdx];
      state.skillOthersSnap[slot] = state.othersCastTotal[secondIdx];
    }
  }

  // Step 6b: Cast extraMembers (group lure). No-op when extraMembers is empty.
  for (const m of lure.extraMembers) {
    const memberIdx = ctx.pokeIdx.get(m.poke.id)!;
    for (let j = 0; j < m.skills.length; j++) {
      state.clock += CAST_TIME;
      state.selfCastTotal[memberIdx] += CAST_TIME;
      tickBagTime(state, ctx, memberIdx, CAST_TIME);

      const slot = ctx.skillSlotByKey.get(`${m.poke.id}:${m.skills[j].name}`)!;
      state.skillCastTime[slot] = state.clock;
      state.skillBaseCD[slot] = m.skills[j].cooldown;
      state.skillSelfSnap[slot] = state.selfCastTotal[memberIdx];
      state.skillOthersSnap[slot] = state.othersCastTotal[memberIdx];
    }
  }

  // Step 7: Finisher cast (device or elixir atk)
  if (lure.usesDevice) {
    state.clock += CAST_TIME;
    state.selfCastTotal[starterIdx] += CAST_TIME;
    tickBagTime(state, ctx, starterIdx, CAST_TIME);
  } else if (lure.usesElixirAtk) {
    state.clock += CAST_TIME;
    const holderIdx = ctx.pokeIdx.get(lure.elixirAtkHolderId ?? lure.starter.id) ?? starterIdx;
    state.selfCastTotal[holderIdx] += CAST_TIME;
    tickBagTime(state, ctx, holderIdx, CAST_TIME);
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

  // Kill time: 10s após cada lure. Todos os pokes em bag (excludeIdx=-1).
  tickBagTime(state, ctx, -1, KILL_TIME);
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

  let lures: Lure[];
  if (options.damageConfig) {
    // Cascata: tenta lures cheap primeiro; só gera caro quando nenhum barato finaliza.
    const cfg = options.damageConfig;
    const filter = (ls: Lure[]) => ls.filter((l) => lureFinalizesBox(l, cfg, cfg.mob));

    lures = filter(generateLureTemplates(bag, devicePokemonId));
    if (lures.length === 0) {
      lures = filter(generateLureTemplates(bag, devicePokemonId, { includeDuplaElixir: true }));
    }
    if (lures.length === 0) {
      lures = filter(
        generateLureTemplates(bag, devicePokemonId, {
          includeDuplaElixir: true,
          includeGroup: true,
        })
      );
    }
  } else {
    lures = generateLureTemplates(bag, devicePokemonId);
  }
  if (lures.length === 0) return null;

  const ctx = buildSimContext(bag);

  let beam: BeamState[] = lures.map((lure) => {
    const sim = emptyState(ctx);
    applyLure(sim, ctx, lure, diskLevel);
    return { sim, sequence: [lure] };
  });

  let bestOverall: { idle: number; result: RotationResult; score: number } | null = null;

  // Scoring cheap: sim.clock / steps.length já é um bom proxy do tempo-por-lure (warmup
  // afeta todos candidatos igualmente). evaluateCycle só roda no top do step, não em cada
  // candidato — cortava ~95% do tempo do beam search.
  const REFINE_TOP = 4;

  for (let step = 1; step < maxCycleLen; step++) {
    const candidates: BeamState[] = [];
    for (const state of beam) {
      for (const lure of lures) {
        const newSim = cloneState(state.sim);
        applyLure(newSim, ctx, lure, diskLevel);
        candidates.push({
          sim: newSim,
          sequence: [...state.sequence, lure],
        });
      }
    }

    const scoredCheap = candidates.map((cand) => ({
      cand,
      score: cand.sim.clock / cand.sim.steps.length,
    }));
    scoredCheap.sort((a, b) => a.score - b.score);
    beam = scoredCheap.slice(0, beamWidth).map((s) => s.cand);

    // Refine top-N com evaluateCycle (steady-state preciso) só pra tracking do bestOverall
    if (step + 1 >= minCycleLen) {
      const topN = scoredCheap.slice(0, REFINE_TOP);
      for (const s of topN) {
        const period = minPeriod(s.cand.sequence);
        const truePeriodSeq = s.cand.sequence.slice(0, period);
        const ev = evaluateCycle(truePeriodSeq, diskLevel, ctx);
        const tpl = ev.result.totalTime / truePeriodSeq.length;
        if (!bestOverall || tpl < bestOverall.score) {
          bestOverall = { idle: ev.idlePerCycle, result: ev.result, score: tpl };
        }
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
  ctx: SimContext
): { idlePerCycle: number; result: RotationResult } {
  const sim = emptyState(ctx);

  // Cycle 1: warmup
  for (const lure of cycle) {
    applyLure(sim, ctx, lure, diskLevel);
  }

  // Cycle 2: measure
  const cycle2Start = sim.clock;
  const cycle2IdleStart = sim.totalIdle;
  const cycle2StepsStart = sim.steps.length;

  for (const lure of cycle) {
    applyLure(sim, ctx, lure, diskLevel);
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
      cycle.flatMap((l) => [
        l.starter.id,
        l.second?.id,
        ...l.extraMembers.map((m) => m.poke.id),
      ].filter(Boolean) as string[])
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
