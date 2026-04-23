import type { DiskLevel, Lure, Pokemon, RotationStep, Skill, ClanName, MobConfig, PokemonElement } from "../../types";
import { ELIXIR_ATK_COOLDOWN, REVIVE_COOLDOWN, bagRate } from "../cooldown";
import { getClanElements } from "../damage";

export const CAST_TIME = 1;
export const KILL_TIME = 10;

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
  reviveReady: number;
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
    reviveReady: 0,
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
  private ctx: SimContext;
  constructor(ctx: SimContext) {
    this.ctx = ctx;
  }

  acquireFresh(): SimState {
    const s = this.free.pop();
    if (s) {
      s.clock = 0;
      s.skillCastTime.fill(-1);
      s.skillBaseCD.fill(0);
      s.skillSelfSnap.fill(0);
      s.selfCastTotal.fill(0);
      s.elixirAtkReady = 0;
      s.reviveReady = 0;
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
        reviveReady: source.reviveReady,
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
    s.reviveReady = source.reviveReady;
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
  /** Bag index do poke revivido (-1 se sem revive). Skills dele ficam com CD=0 pós-revive
   *  e são castadas novamente na mesma lure. */
  reviveIdx: number;
  /** Slots do poke revivido, pra reset em applyLure. Vazio se reviveIdx === -1. */
  reviveSlots: Int32Array;
  reviveCDs: Float64Array;
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

    // Revive: resolve bag index + slots/CDs do poke revivido (pro reset em applyLure).
    let reviveIdx = -1;
    let reviveSlots = new Int32Array(0);
    let reviveCDs = new Float64Array(0);
    if (lure.reviveTier && lure.revivePokemonId) {
      reviveIdx = ctx.pokeIdx.get(lure.revivePokemonId) ?? -1;
      if (reviveIdx >= 0) {
        // Skills do revivido: se é starter, usa starterSkills; se second, secondSkills;
        // senão busca no extraMembers. A cast sequence pós-revive é o MESMO kit que já foi
        // castado, então reaproveita os slots/CDs já computados onde possível.
        let skills: Skill[] = [];
        if (reviveIdx === starterIdx) skills = lure.starterSkills;
        else if (reviveIdx === secondIdx) skills = lure.secondSkills;
        else {
          const m = lure.extraMembers.find((m) => ctx.pokeIdx.get(m.poke.id) === reviveIdx);
          if (m) skills = m.skills;
        }
        const nR = skills.length;
        reviveSlots = new Int32Array(nR);
        reviveCDs = new Float64Array(nR);
        const pokeId = lure.revivePokemonId;
        for (let i = 0; i < nR; i++) {
          reviveSlots[i] = ctx.skillSlotByKey.get(`${pokeId}:${skills[i].name}`)!;
          reviveCDs[i] = skills[i].cooldown;
        }
      }
    }

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
      reviveIdx,
      reviveSlots,
      reviveCDs,
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

export const INFEASIBLE = Number.POSITIVE_INFINITY;

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

  // Step 3: Check elixir atk
  if (lure.usesElixirAtk) {
    const totalCasts = numStarterSkills + numSecondSkills + compiled.totalExtraSkills + 1;
    const elixirCastAt = state.clock + wait + totalCasts;
    const elixirWait = state.elixirAtkReady - elixirCastAt;
    if (elixirWait > 0) wait += elixirWait;
  }

  // Step 3b: Check revive CD. Revive cast acontece após normal casts, antes do finisher.
  if (lure.reviveTier && compiled.reviveIdx >= 0) {
    const preReviveCasts = numStarterSkills + numSecondSkills + compiled.totalExtraSkills;
    const reviveCastAt = state.clock + wait + preReviveCasts;
    const rw = state.reviveReady - reviveCastAt;
    if (rw > 0) wait += rw;
  }

  // Step 4: Advance clock by wait. Durante wait, starter "selected-idle" ganha self-cast 1:1;
  // os demais ficam em bag — mas othersInBag é derivado (clock - self), então basta avançar clock.
  if (wait > 0) {
    state.selfCastTotal[starterIdx] += wait;
    state.clock += wait;
    state.totalIdle += wait;
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

  // Step 6c: Revive — 1s cast do item + revive target casta o kit de novo (CDs resetados).
  // Primeiro cast já aconteceu em steps 5/6/6b; aqui é o SEGUNDO cast do mesmo poke.
  const reviveIdx = compiled.reviveIdx;
  if (reviveIdx >= 0 && lure.reviveTier) {
    // Cast do item (1s). Não conta como self-cast de nenhum poke — é uso de item.
    state.clock += CAST_TIME;
    state.reviveReady = state.clock + REVIVE_COOLDOWN[lure.reviveTier];

    const reviveSlots = compiled.reviveSlots;
    const reviveCDs = compiled.reviveCDs;
    const nR = reviveSlots.length;
    for (let i = 0; i < nR; i++) {
      state.clock += CAST_TIME;
      state.selfCastTotal[reviveIdx] += CAST_TIME;
      const slot = reviveSlots[i];
      state.skillCastTime[slot] = state.clock;
      state.skillBaseCD[slot] = reviveCDs[i];
      state.skillSelfSnap[slot] = state.selfCastTotal[reviveIdx];
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
