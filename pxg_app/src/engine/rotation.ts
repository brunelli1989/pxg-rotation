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
import { getClanElements, lureFinalizesBox, resolveSkillPower } from "./damage";
import type { ClanName, MobConfig, PokemonElement } from "../types";
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

function minPeriod(seq: CompiledLure[]): number {
  const n = seq.length;
  for (let p = 1; p <= n; p++) {
    if (n % p !== 0) continue;
    let ok = true;
    for (let i = p; i < n; i++) {
      if (lureKey(seq[i].lure) !== lureKey(seq[i - p].lure)) {
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
  // Device holder PODE ser dupla starter (ele só é excluído de solo_device se não for T1H,
  // e de "second" role — não faz sentido ser starter e second ao mesmo tempo).
  for (let i = 0; i < n; i++) {
    if (!hardCC[i]) continue;
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
  // Device holder PODE ser membro/extra (seu dano ganha boost via hasDevice no pokeSetup);
  // apenas excluído de ser starter (mesma lógica do dupla).
  const MAX_GROUP_EXTRAS = MAX_BAG - 1;
  if (options.includeGroup) {
    for (let i = 0; i < n; i++) {
      if (!hardCC[i]) continue;
      const starter = bag[i];
      const starterHarden = harden[i];

      const candidateIdx: number[] = [];
      for (let k = 0; k < n; k++) {
        if (k !== i) candidateIdx.push(k);
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
 * State mutável da simulação. Usa typed arrays pra clone rápido via memcpy.
 *
 * Invariante: pra todo poke i, `selfCastTotal[i] + othersInBag[i] == clock`. Logo
 * só trackamos `selfCastTotal`; bag time é derivado on-demand (clock - self).
 * Mesmo pros snapshots por skill slot: guardamos só clock + self no momento do cast.
 */
export interface SimState {
  clock: number;
  // Skill cast tracking: 3 arrays paralelos indexados por slot.
  // skillCastTime[slot] = -1 quando a skill nunca foi castada.
  skillCastTime: Float64Array;
  skillBaseCD: Float64Array;
  skillSelfSnap: Float64Array;
  // Per-poke counter indexado por bag index. othersCastTotal[i] = clock - selfCastTotal[i].
  selfCastTotal: Float64Array;
  elixirAtkReady: number;
  elixirDefReady: number;
  totalIdle: number;
  steps: RotationStep[];
}

export function emptyState(ctx: SimContext): SimState {
  const castTimes = new Float64Array(ctx.skillSlotCount);
  castTimes.fill(-1); // sentinel "nunca castado"
  return {
    clock: 0,
    skillCastTime: castTimes,
    skillBaseCD: new Float64Array(ctx.skillSlotCount),
    skillSelfSnap: new Float64Array(ctx.skillSlotCount),
    selfCastTotal: new Float64Array(ctx.n),
    elixirAtkReady: 0,
    elixirDefReady: 0,
    totalIdle: 0,
    steps: [],
  };
}

/**
 * Pool de SimStates recicláveis. O beam search descarta ~95% dos candidates a cada
 * step; sem pool, são 40k+ allocs/bag de typed arrays. Com pool, alocamos uma vez
 * e reutilizamos via memcpy (Float64Array.set) e reset (length = 0 no steps).
 */
export class SimStatePool {
  private free: SimState[] = [];
  constructor(private ctx: SimContext) {}

  acquireFresh(): SimState {
    const s = this.free.pop();
    if (s) {
      s.clock = 0;
      s.skillCastTime.fill(-1);
      s.skillBaseCD.fill(0);
      s.skillSelfSnap.fill(0);
      s.selfCastTotal.fill(0);
      s.elixirAtkReady = 0;
      s.elixirDefReady = 0;
      s.totalIdle = 0;
      s.steps.length = 0;
      return s;
    }
    return emptyState(this.ctx);
  }

  acquireClone(source: SimState): SimState {
    const s = this.free.pop();
    if (!s) {
      return {
        clock: source.clock,
        skillCastTime: new Float64Array(source.skillCastTime),
        skillBaseCD: new Float64Array(source.skillBaseCD),
        skillSelfSnap: new Float64Array(source.skillSelfSnap),
        selfCastTotal: new Float64Array(source.selfCastTotal),
        elixirAtkReady: source.elixirAtkReady,
        elixirDefReady: source.elixirDefReady,
        totalIdle: source.totalIdle,
        steps: source.steps.slice(),
      };
    }
    s.clock = source.clock;
    s.skillCastTime.set(source.skillCastTime);
    s.skillBaseCD.set(source.skillBaseCD);
    s.skillSelfSnap.set(source.skillSelfSnap);
    s.selfCastTotal.set(source.selfCastTotal);
    s.elixirAtkReady = source.elixirAtkReady;
    s.elixirDefReady = source.elixirDefReady;
    s.totalIdle = source.totalIdle;
    // Reuse steps array: overwrite in place, resize
    const srcSteps = source.steps;
    const n = srcSteps.length;
    s.steps.length = n;
    for (let i = 0; i < n; i++) s.steps[i] = srcSteps[i];
    return s;
  }

  release(s: SimState) {
    this.free.push(s);
  }
}

/**
 * Lure com slots e baseCDs pré-resolvidos contra um SimContext específico.
 * Elimina ~12 map lookups por applyLure call + strings temp de `${id}:${name}`.
 */
export interface CompiledLure {
  lure: Lure;
  starterIdx: number;
  secondIdx: number;                // -1 se sem second
  holderIdx: number;                // poke que paga o cast do elixir (starterIdx fallback)
  starterSlots: Int32Array;
  starterCDs: Float64Array;
  secondSlots: Int32Array;          // length 0 se sem second
  secondCDs: Float64Array;
  extraMemberIdxs: Int32Array;      // bag indices dos extra members
  extraSlots: Int32Array[];         // slots por extra member
  extraCDs: Float64Array[];         // cooldowns por extra member
  totalExtraSkills: number;
  /** Score multiplier do starter vs mob (starter é o mais exposto).
   *  < 1 = resistente (preferido); > 1 = fraco (evitado); 1 = neutro/sem info.
   *  Calculado como sqrt(dmgTakenMult) pra dampear o efeito no beam. */
  starterResistFactor: number;
}

export function compileLures(
  lures: Lure[],
  ctx: SimContext,
  mob?: MobConfig,
  clan?: ClanName | null
): CompiledLure[] {
  // Pré-computa conjuntos pro cálculo do starterResistFactor.
  // ideal = bestStarterElements ∩ clan_elements (tanka o mob + recebe clan bonus no dmg)
  const bestEls: PokemonElement[] = mob?.bestStarterElements ?? [];
  const clanEls: PokemonElement[] = clan ? getClanElements(clan) : [];
  const idealSet = new Set<PokemonElement>(bestEls.filter((e) => clanEls.includes(e)));
  const bestSet = new Set<PokemonElement>(bestEls);

  const out: CompiledLure[] = new Array(lures.length);
  for (let k = 0; k < lures.length; k++) {
    const lure = lures[k];
    const starterIdx = ctx.pokeIdx.get(lure.starter.id)!;
    const secondIdx = lure.second ? ctx.pokeIdx.get(lure.second.id)! : -1;

    const nS = lure.starterSkills.length;
    const starterSlots = new Int32Array(nS);
    const starterCDs = new Float64Array(nS);
    for (let i = 0; i < nS; i++) {
      const s = lure.starterSkills[i];
      starterSlots[i] = ctx.skillSlotByKey.get(`${lure.starter.id}:${s.name}`)!;
      starterCDs[i] = s.cooldown;
    }

    const nS2 = lure.secondSkills.length;
    const secondSlots = new Int32Array(nS2);
    const secondCDs = new Float64Array(nS2);
    if (lure.second) {
      for (let j = 0; j < nS2; j++) {
        const s = lure.secondSkills[j];
        secondSlots[j] = ctx.skillSlotByKey.get(`${lure.second.id}:${s.name}`)!;
        secondCDs[j] = s.cooldown;
      }
    }

    const nExtras = lure.extraMembers.length;
    const extraMemberIdxs = new Int32Array(nExtras);
    const extraSlots: Int32Array[] = new Array(nExtras);
    const extraCDs: Float64Array[] = new Array(nExtras);
    let totalExtraSkills = 0;
    for (let m = 0; m < nExtras; m++) {
      const member = lure.extraMembers[m];
      extraMemberIdxs[m] = ctx.pokeIdx.get(member.poke.id)!;
      const nM = member.skills.length;
      const slots = new Int32Array(nM);
      const cds = new Float64Array(nM);
      for (let j = 0; j < nM; j++) {
        const s = member.skills[j];
        slots[j] = ctx.skillSlotByKey.get(`${member.poke.id}:${s.name}`)!;
        cds[j] = s.cooldown;
      }
      extraSlots[m] = slots;
      extraCDs[m] = cds;
      totalExtraSkills += nM;
    }

    const holderIdx =
      lure.usesElixirAtk && lure.elixirAtkHolderId
        ? (ctx.pokeIdx.get(lure.elixirAtkHolderId) ?? starterIdx)
        : starterIdx;

    // Preferência pro starter, 3 tiers:
    //   type ∈ (bestStarterElements ∩ clan_elements)  → 0.60 (ideal: tanka + clan bonus)
    //   type ∈ bestStarterElements (fora do clã)       → 0.75 (só defesa)
    //   senão                                          → 1.00 (neutro)
    let starterResistFactor = 1;
    const starterEls = lure.starter.elements;
    if (starterEls && starterEls.length > 0) {
      let inIdeal = false;
      let inBest = false;
      for (const e of starterEls) {
        if (idealSet.has(e)) { inIdeal = true; break; }
        if (bestSet.has(e)) inBest = true;
      }
      if (inIdeal) starterResistFactor = 0.60;
      else if (inBest) starterResistFactor = 0.75;
    }

    out[k] = {
      lure,
      starterIdx,
      secondIdx,
      holderIdx,
      starterSlots,
      starterCDs,
      secondSlots,
      secondCDs,
      extraMemberIdxs,
      extraSlots,
      extraCDs,
      totalExtraSkills,
      starterResistFactor,
    };
  }
  return out;
}

const KILL_TIME = 10; // seconds of kill time after each lure's finisher (all pokes in bag, disk still applies)

/**
 * Computes the wait needed for a starter skill (cast at lure_start + offset).
 * During wait, starter é "selected-idle" → self-cast progride 1:1; ninguém mais
 * casta, então othersCast do starter fica parado.
 *
 * Recovery = deltaSelf + deltaOthers × rate, onde deltaOthers = deltaClock - deltaSelf.
 * Ready quando recovery >= baseCD.
 */
function waitForStarterSkill(
  state: SimState,
  pokeIdx: number,
  slot: number,
  offset: number,
  rate: number
): number {
  if (state.skillCastTime[slot] < 0) return 0;

  const deltaClock = state.clock - state.skillCastTime[slot];
  const selfPast = state.selfCastTotal[pokeIdx] - state.skillSelfSnap[slot];
  const othersPast = deltaClock - selfPast;

  const required = state.skillBaseCD[slot] - selfPast - offset - othersPast * rate;
  return Math.max(0, required);
}

/**
 * Required wait for a SECOND's skill to be ready.
 * Durante wait, second fica em bag (ganha bag time a disk rate).
 * Durante casts do starter, second também em bag (num_starter seconds).
 * Durante casts do próprio second, ganha self-cast 1:1.
 *
 * W >= (baseCD - selfPast - (j+1)) / rate - (othersPast + offsetBeforeOwnCast)
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

  const deltaClock = state.clock - state.skillCastTime[slot];
  const selfPast = state.selfCastTotal[pokeIdx] - state.skillSelfSnap[slot];
  const othersPast = deltaClock - selfPast;

  const required =
    (state.skillBaseCD[slot] - selfPast - offsetWithinOwnCast) / rate - (othersPast + offsetBeforeOwnCast);
  return Math.max(0, required);
}

const INFEASIBLE = Number.POSITIVE_INFINITY;

export function applyLure(
  state: SimState,
  compiled: CompiledLure,
  diskLevel: DiskLevel
): RotationStep {
  const stepStart = state.clock;
  const rate = bagRate(diskLevel);

  const lure = compiled.lure;
  const starterIdx = compiled.starterIdx;
  const secondIdx = compiled.secondIdx;
  const starterSlots = compiled.starterSlots;
  const starterCDs = compiled.starterCDs;
  const secondSlots = compiled.secondSlots;
  const secondCDs = compiled.secondCDs;
  const extraMemberIdxs = compiled.extraMemberIdxs;
  const extraSlots = compiled.extraSlots;
  const extraCDs = compiled.extraCDs;
  const numStarterSkills = starterSlots.length;
  const numSecondSkills = secondSlots.length;
  const numExtras = extraMemberIdxs.length;

  // Compute wait needed for all skills (starter + second + extras). Wait = max over all required.
  let wait = 0;

  for (let i = 0; i < numStarterSkills; i++) {
    const w = waitForStarterSkill(state, starterIdx, starterSlots[i], i + 1, rate);
    if (w > wait) wait = w;
  }

  if (secondIdx >= 0) {
    for (let j = 0; j < numSecondSkills; j++) {
      const w = waitForSecondSkill(state, secondIdx, secondSlots[j], j + 1, numStarterSkills, rate);
      if (w > wait) wait = w;
    }
  }

  // Group: extraMembers cast after starter + second. Each extra has offsetBefore = all
  // casts before it starts (starter + second + prior extras).
  let offsetBeforeExtra = numStarterSkills + numSecondSkills;
  for (let m = 0; m < numExtras; m++) {
    const memberIdx = extraMemberIdxs[m];
    const slots = extraSlots[m];
    const nM = slots.length;
    for (let j = 0; j < nM; j++) {
      const w = waitForSecondSkill(state, memberIdx, slots[j], j + 1, offsetBeforeExtra, rate);
      if (w > wait) wait = w;
    }
    offsetBeforeExtra += nM;
  }

  // Step 3: Check elixir atk / def
  if (lure.usesElixirAtk) {
    const totalCasts = numStarterSkills + numSecondSkills + compiled.totalExtraSkills + 1;
    const elixirCastAt = state.clock + wait + totalCasts;
    const elixirWait = state.elixirAtkReady - elixirCastAt;
    if (elixirWait > 0) wait += elixirWait;
  }
  if (lure.starterUsesElixirDef) {
    const defWait = state.elixirDefReady - (state.clock + wait);
    if (defWait > 0) wait += defWait;
  }

  // Step 4: Advance clock by wait. Durante wait, starter "selected-idle" ganha self-cast 1:1;
  // os demais ficam em bag — mas othersInBag é derivado (clock - self), então basta avançar clock.
  if (wait > 0) {
    state.selfCastTotal[starterIdx] += wait;
    state.clock += wait;
    state.totalIdle += wait;
  }

  // Consume elixir def at lure start
  if (lure.starterUsesElixirDef) {
    state.elixirDefReady = state.clock + ELIXIR_DEF_COOLDOWN;
  }

  // Step 5: Cast starter skills. Cada cast: clock +=1, self do caster +=1; outros ganham
  // bag time implícito via (clock - self). Snapshot só precisa guardar (clock, self).
  for (let i = 0; i < numStarterSkills; i++) {
    state.clock += CAST_TIME;
    state.selfCastTotal[starterIdx] += CAST_TIME;

    const slot = starterSlots[i];
    state.skillCastTime[slot] = state.clock;
    state.skillBaseCD[slot] = starterCDs[i];
    state.skillSelfSnap[slot] = state.selfCastTotal[starterIdx];
  }

  // Step 6: Cast second skills (dupla + group)
  if (secondIdx >= 0) {
    for (let j = 0; j < numSecondSkills; j++) {
      state.clock += CAST_TIME;
      state.selfCastTotal[secondIdx] += CAST_TIME;

      const slot = secondSlots[j];
      state.skillCastTime[slot] = state.clock;
      state.skillBaseCD[slot] = secondCDs[j];
      state.skillSelfSnap[slot] = state.selfCastTotal[secondIdx];
    }
  }

  // Step 6b: Cast extraMembers (group lure). No-op when numExtras === 0.
  for (let m = 0; m < numExtras; m++) {
    const memberIdx = extraMemberIdxs[m];
    const slots = extraSlots[m];
    const cds = extraCDs[m];
    const nM = slots.length;
    for (let j = 0; j < nM; j++) {
      state.clock += CAST_TIME;
      state.selfCastTotal[memberIdx] += CAST_TIME;

      const slot = slots[j];
      state.skillCastTime[slot] = state.clock;
      state.skillBaseCD[slot] = cds[j];
      state.skillSelfSnap[slot] = state.selfCastTotal[memberIdx];
    }
  }

  // Step 7: Finisher cast (device or elixir atk)
  if (lure.usesDevice) {
    state.clock += CAST_TIME;
    state.selfCastTotal[starterIdx] += CAST_TIME;
  } else if (lure.usesElixirAtk) {
    state.clock += CAST_TIME;
    state.selfCastTotal[compiled.holderIdx] += CAST_TIME;
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

  // Kill time: 10s após cada lure. Todos em bag → só avança clock (bag time derivado).
  state.clock += KILL_TIME;

  return step;
}

export { INFEASIBLE };

// =========================================================
// Beam search
// =========================================================

interface BeamState {
  sim: SimState;
  sequence: CompiledLure[]; // ref to original via .lure
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
): { idle: number; result: RotationResult; score: number } | null {
  const beamWidth = options.beamWidth ?? 120;
  const maxCycleLen = options.maxCycleLen ?? 12;
  const minCycleLen = options.minCycleLen ?? 2;

  let lures: Lure[];
  if (options.damageConfig) {
    // Cascata: tenta lures cheap primeiro; só gera caro quando nenhum barato finaliza.
    const cfg = options.damageConfig;
    const best = cfg.mob.bestStarterElements ?? [];

    // Hard filter: se a bag tem pelo menos um starter viável cujo tipo está em
    // bestStarterElements, os demais são proibidos como starter (ainda podem ser
    // second/extra). Fallback automaticamente pra sem filtro se não sobrar lure viável.
    const starterTypeOk = (l: Lure): boolean => {
      if (best.length === 0) return true;
      const els = l.starter.elements;
      if (!els || els.length === 0) return true;
      return els.some((e) => best.includes(e));
    };
    const lureSize = (l: Lure) => 1 + (l.second ? 1 : 0) + l.extraMembers.length;
    const filter = (ls: Lure[]) => {
      const dmgOk = ls.filter((l) => lureFinalizesBox(l, cfg, cfg.mob));
      const typeOk = dmgOk.filter(starterTypeOk);
      return typeOk.length > 0 ? typeOk : dmgOk;
    };

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

    // Regra de força do player: "a partir do momento que o player consegue finalizar
    // com 3 pokes é possível lurar com T1H". Se nenhuma lure de ≤3 membros finaliza,
    // o player é "fraco" → starter precisa ter skill com def:true (offtank real).
    // T1H burst_dd sem def skill fica banido de ser starter nesse caso.
    const hasSmallLure = lures.some((l) => lureSize(l) <= 3);
    if (!hasSmallLure) {
      const withDef = lures.filter((l) =>
        l.starter.skills.some((s) => s.def === true)
      );
      if (withDef.length > 0) lures = withDef;
    }
  } else {
    lures = generateLureTemplates(bag, devicePokemonId);
  }
  if (lures.length === 0) return null;

  const ctx = buildSimContext(bag);
  const compiled = compileLures(lures, ctx, options.damageConfig?.mob, options.damageConfig?.clan);
  const pool = new SimStatePool(ctx);

  let beam: BeamState[] = compiled.map((c) => {
    const sim = pool.acquireFresh();
    applyLure(sim, c, diskLevel);
    return { sim, sequence: [c] };
  });

  let bestOverall: { idle: number; result: RotationResult; score: number } | null = null;

  // Scoring cheap: sim.clock / steps.length já é um bom proxy do tempo-por-lure (warmup
  // afeta todos candidatos igualmente). evaluateCycle só roda no top do step, não em cada
  // candidato — cortava ~95% do tempo do beam search.
  const REFINE_TOP = 4;

  for (let step = 1; step < maxCycleLen; step++) {
    const candidates: BeamState[] = [];
    for (const state of beam) {
      for (const c of compiled) {
        const newSim = pool.acquireClone(state.sim);
        applyLure(newSim, c, diskLevel);
        candidates.push({
          sim: newSim,
          sequence: [...state.sequence, c],
        });
      }
    }

    // Release parent states — candidates já têm clones independentes.
    for (const old of beam) pool.release(old.sim);

    const scoredCheap = candidates.map((cand) => {
      const tpl = cand.sim.clock / cand.sim.steps.length;
      let sumResist = 0;
      for (const c of cand.sequence) sumResist += c.starterResistFactor;
      const avgResist = sumResist / cand.sequence.length;
      return { cand, score: tpl * avgResist };
    });
    scoredCheap.sort((a, b) => a.score - b.score);
    beam = scoredCheap.slice(0, beamWidth).map((s) => s.cand);

    // Release candidates que não entraram no beam
    for (let i = beamWidth; i < scoredCheap.length; i++) {
      pool.release(scoredCheap[i].cand.sim);
    }

    // Refine top-N com evaluateCycle (steady-state preciso) só pra tracking do bestOverall.
    // bestOverall.score inclui o starterResistFactor pra manter consistência com o beam ranking.
    if (step + 1 >= minCycleLen) {
      const topN = scoredCheap.slice(0, REFINE_TOP);
      for (const s of topN) {
        const period = minPeriod(s.cand.sequence);
        const truePeriodSeq = s.cand.sequence.slice(0, period);
        const ev = evaluateCycle(truePeriodSeq, diskLevel, ctx, pool);
        const tpl = ev.result.totalTime / truePeriodSeq.length;
        let sumResist = 0;
        for (const c of truePeriodSeq) sumResist += c.starterResistFactor;
        const adjustedTpl = tpl * (sumResist / truePeriodSeq.length);
        if (!bestOverall || adjustedTpl < bestOverall.score) {
          bestOverall = { idle: ev.idlePerCycle, result: ev.result, score: adjustedTpl };
        }
      }
    }
  }

  if (!bestOverall) return null;
  return { idle: bestOverall.idle, result: bestOverall.result, score: bestOverall.score };
}

/**
 * Evaluates a cycle by running it twice back-to-back and measuring
 * idle time in the second cycle. Returns null if any lure is infeasible.
 */
function evaluateCycle(
  cycle: CompiledLure[],
  diskLevel: DiskLevel,
  ctx: SimContext,
  pool?: SimStatePool
): { idlePerCycle: number; result: RotationResult } {
  const sim = pool ? pool.acquireFresh() : emptyState(ctx);

  // Cycle 1: warmup
  for (const c of cycle) {
    applyLure(sim, c, diskLevel);
  }

  // Cycle 2: measure
  const cycle2Start = sim.clock;
  const cycle2IdleStart = sim.totalIdle;
  const cycle2StepsStart = sim.steps.length;

  for (const c of cycle) {
    applyLure(sim, c, diskLevel);
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
      cycle.flatMap((c) => [
        c.lure.starter.id,
        c.lure.second?.id,
        ...c.lure.extraMembers.map((m) => m.poke.id),
      ].filter(Boolean) as string[])
    )
  );

  const deviceLure = cycle.find((c) => c.lure.usesDevice);

  if (pool) pool.release(sim);

  return {
    idlePerCycle: cycle2Idle,
    result: {
      steps: cycle2Steps,
      totalTime: cycle2End - cycle2Start,
      totalIdle: cycle2Idle,
      cycleNumber: 2,
      selectedIds,
      devicePokemonId: deviceLure ? deviceLure.lure.starter.id : null,
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
): { idle: number; result: RotationResult; score: number } | null {
  // User override: se algum poke na bag tem hasDevice=true no pokeSetup, usa ele
  // como device holder (qualquer tier), pulando a heurística automática.
  const userDesignated = bag.find(
    (p) => options?.damageConfig?.pokeSetups?.[p.id]?.hasDevice === true && hasHardCC(p)
  );
  if (userDesignated) {
    return findBestRotation(bag, diskLevel, userDesignated.id, options ?? {});
  }

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

  let best: { idle: number; result: RotationResult; score: number } | null = null;
  let bestScore = Infinity;
  for (const deviceId of deviceCandidates) {
    const res = findBestRotation(bag, diskLevel, deviceId, options);
    if (res && res.score < bestScore) {
      bestScore = res.score;
      best = res;
    }
  }
  return best;
}
