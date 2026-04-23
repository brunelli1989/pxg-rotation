import type { Lure, LureMember, Pokemon } from "../../types";
import { getClanElements, resolveSkillPower } from "../damage";
import type { ClanName } from "../../types";
import { getOptimalSkillOrder, hasAnyCC, hasFrontal, hasHardCC, hasHarden, hasSilence } from "../scoring";

export const MAX_BAG = 6;

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

/**
 * Elixir atk vai no poke mais forte do lure (sum de skill_power calibrado/fallback).
 * Heurística: skills area somam mais dano efetivo; frontais pesam igual pro ranking
 * (o usuário ainda consegue colocar elixir em offtank T1H se ele aparecer).
 */
export function pickElixirHolder(members: Pokemon[]): Pokemon {
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

export function generateLureTemplates(
  bag: Pokemon[],
  devicePokemonId: string | null,
  options: {
    includeDuplaElixir?: boolean;
    includeGroup?: boolean;
    hunt?: "300" | "400+";
    clan?: ClanName | null;
    /** Permite gerar lures com Elixir Atk (solo_elixir, dupla+elixir, group+elixir).
     *  Default true. Não afeta Elixir Def. */
    allowElixirAtk?: boolean;
    /** Tier de revive disponível ("none" = não gera variants revive). Revive reseta CDs
     *  do poke mais forte da lure e ele casta o kit 2 vezes na mesma lure. */
    reviveTier?: "none" | "normal" | "superior";
  } = {}
): Lure[] {
  const allowElixirAtk = options.allowElixirAtk ?? true;
  const reviveTier = options.reviveTier ?? "none";
  const reviveEnabled = reviveTier !== "none";
  const lures: Lure[] = [];
  const n = bag.length;

  // Starter preference depende do hunt level:
  //   Hunt 300:  offtank || T1H-clã || lure usa consumível (elixir atk OU revive)
  //   Hunt 400+: offtank || T1H-clã APENAS (consumível não desbloqueia starter fraco).
  // Em 400+ os mobs são tank-demais pra player lurar com starter TR/T2/T3 mesmo com item.
  const hunt400 = options.hunt === "400+";
  const clanEls = options.clan ? getClanElements(options.clan) : [];
  const isOfftank = (p: Pokemon) => p.role === "offensive_tank";
  const isT1HClan = (p: Pokemon) =>
    p.tier === "T1H" && (p.elements ?? []).some((e) => clanEls.includes(e));

  // Flags cacheadas por índice da bag (evita chamar has*() centenas de vezes)
  const hardCC = new Array<boolean>(n);
  const anyCC = new Array<boolean>(n);
  const harden = new Array<boolean>(n);
  const silence = new Array<boolean>(n);
  const frontal = new Array<boolean>(n);
  const offtankOrClan = new Array<boolean>(n);
  for (let i = 0; i < n; i++) {
    hardCC[i] = hasHardCC(bag[i]);
    anyCC[i] = hasAnyCC(bag[i]);
    harden[i] = hasHarden(bag[i]);
    silence[i] = hasSilence(bag[i]);
    frontal[i] = hasFrontal(bag[i]);
    offtankOrClan[i] = isOfftank(bag[i]) || isT1HClan(bag[i]);
  }

  const deviceIdx = devicePokemonId
    ? bag.findIndex((p) => p.id === devicePokemonId)
    : -1;
  const devicePoke = deviceIdx >= 0 ? bag[deviceIdx] : null;

  // Solo T1H + device. Starter sem frontal (frontal não protege os 6 mobs da box).
  // Sem elixir → precisa ser offtank ou T1H-do-clã pra starter.
  if (devicePoke && devicePoke.tier === "T1H" && hardCC[deviceIdx] && !frontal[deviceIdx] && offtankOrClan[deviceIdx]) {
    const soloDeviceBase = {
      type: "solo_device" as const,
      starter: devicePoke,
      second: null,
      starterSkills: getOptimalSkillOrder(devicePoke),
      secondSkills: [],
      starterUsesHarden: false,
      usesElixirAtk: false,
      usesDevice: true,
      extraMembers: [],
      elixirAtkHolderId: null,
    };
    lures.push({ ...soloDeviceBase, reviveTier: null, revivePokemonId: null });
    if (reviveEnabled) {
      lures.push({
        ...soloDeviceBase,
        reviveTier: reviveTier as "normal" | "superior",
        revivePokemonId: devicePoke.id,
      });
    }
  }

  // Solo T2/T3/TR + elixir atk (starter must have CC, no frontal).
  // Hunt 300: consumível desbloqueia. Hunt 400+: só offtank (T1H-clã não entra aqui
  // porque solo_elixir proíbe T1H tier) — efetivamente só T2/T3 offtanks.
  for (let i = 0; i < n; i++) {
    if (!allowElixirAtk) break;
    if (i === deviceIdx) continue;
    const p = bag[i];
    if (p.tier === "T1H") continue;
    if (!hardCC[i]) continue;
    if (frontal[i]) continue;
    if (hunt400 && !offtankOrClan[i]) continue;

    const soloElixirBase = {
      type: "solo_elixir" as const,
      starter: p,
      second: null,
      starterSkills: getOptimalSkillOrder(p),
      secondSkills: [],
      starterUsesHarden: harden[i],
      usesElixirAtk: true,
      usesDevice: false,
      extraMembers: [],
      elixirAtkHolderId: p.id,
    };
    lures.push({ ...soloElixirBase, reviveTier: null, revivePokemonId: null });
    if (reviveEnabled) {
      lures.push({
        ...soloElixirBase,
        reviveTier: reviveTier as "normal" | "superior",
        revivePokemonId: p.id,
      });
    }
  }

  // Dupla: starter (com CC área, sem frontal) + second (qualquer — second é finalizer
  // na dupla, não precisa de CC). Matriz de validade pré-computada.
  // Device holder PODE ser dupla starter (ele só é excluído de solo_device se não for T1H,
  // e de "second" role — não faz sentido ser starter e second ao mesmo tempo).
  for (let i = 0; i < n; i++) {
    if (!hardCC[i] || frontal[i]) continue;
    // Hunt 400+: só offtank/T1H-clã pode starter (mesmo com consumível, fica proibido).
    if (hunt400 && !offtankOrClan[i]) continue;
    const starter = bag[i];
    const starterHarden = harden[i];
    // Starter não-offtank e não-T1H-clã só entra se a lure usa Elixir Atk (hunt 300).
    const needsElixirToStarter = !offtankOrClan[i];

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
        usesDevice: false,
        extraMembers: [],
      };
      const duplaMembers = [starter, second];
      const reviveTarget = reviveEnabled ? pickElixirHolder(duplaMembers) : null;
      if (!needsElixirToStarter) {
        lures.push({ ...baseDupla, usesElixirAtk: false, elixirAtkHolderId: null, reviveTier: null, revivePokemonId: null });
        if (reviveTarget) {
          lures.push({
            ...baseDupla, usesElixirAtk: false, elixirAtkHolderId: null,
            reviveTier: reviveTier as "normal" | "superior", revivePokemonId: reviveTarget.id,
          });
        }
      }
      // Revive também habilita starter "fraco" (não-offtank, não-T1H-clã) — gasto de item.
      if (needsElixirToStarter && reviveTarget) {
        lures.push({
          ...baseDupla, usesElixirAtk: false, elixirAtkHolderId: null,
          reviveTier: reviveTier as "normal" | "superior", revivePokemonId: reviveTarget.id,
        });
      }
      // Dupla + elixir atk: útil em hunt 400+ quando a dupla raw não finaliza a box.
      if (options.includeDuplaElixir && allowElixirAtk) {
        const holder = pickElixirHolder(duplaMembers);
        lures.push({ ...baseDupla, usesElixirAtk: true, elixirAtkHolderId: holder.id, reviveTier: null, revivePokemonId: null });
        if (reviveTarget) {
          lures.push({
            ...baseDupla, usesElixirAtk: true, elixirAtkHolderId: holder.id,
            reviveTier: reviveTier as "normal" | "superior", revivePokemonId: reviveTarget.id,
          });
        }
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
      if (!hardCC[i] || frontal[i]) continue;
      if (hunt400 && !offtankOrClan[i]) continue;
      const starter = bag[i];
      const starterHarden = harden[i];
      const needsElixirToStarter = !offtankOrClan[i];

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

          // Finalizer rule: só o ÚLTIMO poke na chain pode ser sem CC (starter casta
          // CC inicial, middle members reaplicam CC, o finalizer casta por último e
          // nada vem depois — então não precisa de CC). Max 1 no-CC por lure.
          // Reordena pra colocar o no-CC na última posição (finalizer).
          let noCCCount = 0;
          for (const k of combo) if (!anyCC[k]) noCCCount++;
          if (noCCCount > 1) continue;

          let orderedCombo = combo;
          if (noCCCount === 1) {
            orderedCombo = [...combo.filter((k) => anyCC[k]), ...combo.filter((k) => !anyCC[k])];
          }

          const second = bag[orderedCombo[0]];
          const rest = orderedCombo.slice(1).map<LureMember>((k) => ({
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
            usesDevice: false,
            extraMembers: rest,
          };
          // Group+revive não é gerado: explosão de variantes (C(5,k) × elixir × revive) causa
          // OOM em pools médias. Revive em group não é padrão comum no jogo anyway — high-value
          // use case é solo + dupla (mesmo poke castando 2×).
          if (!needsElixirToStarter) {
            lures.push({ ...base, usesElixirAtk: false, elixirAtkHolderId: null, reviveTier: null, revivePokemonId: null });
          }
          if (allowElixirAtk) {
            const holder = pickElixirHolder([starter, second, ...rest.map((m) => m.poke)]);
            lures.push({ ...base, usesElixirAtk: true, elixirAtkHolderId: holder.id, reviveTier: null, revivePokemonId: null });
          }
        }
      }
    }
  }

  return lures;
}
