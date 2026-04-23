import type { HuntLevel, MobConfig, MobEntry } from "../../types";

// Fallback quando mob não tem defFactor calibrado (média dos mobs testados no dummy).
export const DEFAULT_MOB_DEF_FACTOR = 0.85;

// =========================================================
// Mob resolver — preenche HP/defFactor ausentes via fallback hierárquico:
// 1. valor explícito no mobs.json
// 2. dentro do grupo: mobs irmãos têm mesmo effective_HP (HP × 1/defFactor)
// 3. média do hunt tier (cross-group, SÓ mobs do MESMO hunt — 300 não contamina 400+)
// 4. DEFAULT_MOB_DEF_FACTOR (só quando nenhum mob do hunt tier está calibrado)
// =========================================================

export type MobFieldSource = "measured" | "group" | "hunt-avg" | "default";

export interface ResolvedMob extends MobConfig {
  hpSource: MobFieldSource;
  defSource: MobFieldSource;
}

function groupEffHp(entry: MobEntry, allMobs: MobEntry[]): number | undefined {
  const anchor = allMobs.find(
    (m) => m.group === entry.group && m.hp !== undefined && m.defFactor !== undefined
  );
  return anchor ? anchor.hp! / anchor.defFactor! : undefined;
}

function huntAvgEffHp(hunt: HuntLevel, allMobs: MobEntry[]): number | undefined {
  const samples = allMobs
    .filter((m) => m.hunt === hunt && m.hp !== undefined && m.defFactor !== undefined)
    .map((m) => m.hp! / m.defFactor!);
  if (samples.length === 0) return undefined;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

function huntAvgDefFactor(hunt: HuntLevel, allMobs: MobEntry[]): number | undefined {
  const samples = allMobs
    .filter((m) => m.hunt === hunt && m.defFactor !== undefined)
    .map((m) => m.defFactor!);
  if (samples.length === 0) return undefined;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

export function resolveMobConfig(entry: MobEntry, allMobs: MobEntry[]): ResolvedMob {
  let hp = entry.hp;
  let def = entry.defFactor;
  let hpSource: MobFieldSource = hp !== undefined ? "measured" : "default";
  let defSource: MobFieldSource = def !== undefined ? "measured" : "default";

  const effGroup = groupEffHp(entry, allMobs);
  if (effGroup !== undefined) {
    if (hp === undefined && def !== undefined) {
      hp = Math.round(effGroup * def);
      hpSource = "group";
    } else if (def === undefined && hp !== undefined) {
      def = Number((hp / effGroup).toFixed(3));
      defSource = "group";
    }
  }

  // defFactor hunt-avg: média dos mobs calibrados do MESMO hunt tier.
  // Mobs 300 e 400+ têm dureza sistematicamente diferente — não faz sentido usar
  // fallback global 0.85 pra um mob 400+ quando outros mobs 400+ estão calibrados.
  if (def === undefined) {
    const avgDef = huntAvgDefFactor(entry.hunt, allMobs);
    if (avgDef !== undefined) {
      def = Number(avgDef.toFixed(3));
      defSource = "hunt-avg";
    }
  }

  if (hp === undefined) {
    const effHunt = huntAvgEffHp(entry.hunt, allMobs);
    const usedDef = def ?? DEFAULT_MOB_DEF_FACTOR;
    if (effHunt !== undefined) {
      hp = Math.round(effHunt * usedDef);
      hpSource = "hunt-avg";
    }
  }

  return {
    name: entry.name,
    types: entry.types,
    hp: hp ?? 0,
    defFactor: def,
    bestStarterElements: entry.bestStarterElements,
    hpSource,
    defSource,
  };
}
