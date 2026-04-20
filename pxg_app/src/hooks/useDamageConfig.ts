import { useState, useEffect, useCallback } from "react";
import type {
  DamageConfig,
  ClanName,
  HuntLevel,
  PokeSetup,
  MobConfig,
  MobEntry,
  StarterRoleFilter,
  XAtkTier,
  PokemonElement,
  DeviceHeld,
} from "../types";
import mobsDataRaw from "../data/mobs.json";

const mobsData = mobsDataRaw as MobEntry[];

const STORAGE_KEY = "pxg_damage_config";

export const DEFAULT_POKE_SETUP: PokeSetup = {
  boost: 70,
  held: { kind: "none", tier: 0 },
  hasDevice: false,
};

const DEFAULT_CONFIG: DamageConfig = {
  playerLvl: 300,
  clan: null,
  hunt: "300",
  mob: { name: "Dratini", types: ["dragon"], hp: 191610, defFactor: 0.80 },
  device: { kind: "x-attack", tier: 4 },
  pokeSetups: {},
  skillCalibrations: {},
};

function loadConfig(): DamageConfig {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_CONFIG;
  try {
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULT_CONFIG, ...parsed };
    // Migration: old schema had mob.type (string), new has mob.types (array)
    if (merged.mob) {
      merged.mob = { ...DEFAULT_CONFIG.mob, ...merged.mob };
      const anyMob = merged.mob as { type?: PokemonElement; types?: PokemonElement[] };
      if (!Array.isArray(anyMob.types)) {
        anyMob.types = anyMob.type ? [anyMob.type] : ["normal"];
        delete anyMob.type;
      }
    }
    // Migration: add global device (was per-poke antes)
    if (!merged.device) {
      merged.device = { kind: "x-attack", tier: 4 };
    }
    // Migration: re-hidrata campos derivados (bestStarterElements, defFactor, hp, types)
    // do mobs.json quando o nome bate. defFactor e hp mudam com calibração e queremos
    // sempre pegar o valor mais recente. User não edita esses campos no UI — é source of truth.
    if (merged.mob) {
      const name = merged.mob.name;
      const match = mobsData.find((m) => m.name === name || m.group === name);
      if (match) {
        if (match.bestStarterElements) merged.mob.bestStarterElements = match.bestStarterElements;
        if (match.defFactor !== undefined) merged.mob.defFactor = match.defFactor;
        if (match.hp !== undefined) merged.mob.hp = match.hp;
        if (match.types) merged.mob.types = match.types;
      }
    }
    // Migration: pokeSetups — converte xAtkTier/xBoostTier legado pra held único
    if (merged.pokeSetups) {
      for (const k of Object.keys(merged.pokeSetups)) {
        const s = merged.pokeSetups[k] as Partial<PokeSetup> & {
          xAtkTier?: XAtkTier;
          xBoostTier?: XAtkTier;
          deviceXAtkTier?: XAtkTier;
          deviceXBoostTier?: XAtkTier;
        };
        if (!s.held) {
          if (s.xAtkTier && s.xAtkTier > 0) {
            s.held = { kind: "x-attack", tier: s.xAtkTier };
          } else if (s.xBoostTier && s.xBoostTier > 0) {
            s.held = { kind: "x-boost", tier: s.xBoostTier };
          } else {
            s.held = { kind: "none", tier: 0 };
          }
        }
        delete s.xAtkTier;
        delete s.xBoostTier;
        delete s.deviceXAtkTier;
        delete s.deviceXBoostTier;
      }
    }
    return merged;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function useDamageConfig() {
  const [config, setConfig] = useState<DamageConfig>(() => loadConfig());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  const setPlayerLvl = useCallback((v: number) => {
    setConfig((c) => ({ ...c, playerLvl: v }));
  }, []);

  const setClan = useCallback((v: ClanName | null) => {
    setConfig((c) => ({ ...c, clan: v }));
  }, []);

  const setHunt = useCallback((v: HuntLevel) => {
    setConfig((c) => ({ ...c, hunt: v }));
  }, []);

  const setMob = useCallback((mob: Partial<MobConfig>) => {
    setConfig((c) => ({ ...c, mob: { ...c.mob, ...mob } }));
  }, []);

  const setPokeSetup = useCallback((pokeId: string, setup: Partial<PokeSetup>) => {
    setConfig((c) => {
      const current = c.pokeSetups[pokeId] ?? DEFAULT_POKE_SETUP;
      return {
        ...c,
        pokeSetups: { ...c.pokeSetups, [pokeId]: { ...current, ...setup } },
      };
    });
  }, []);

  const setDevice = useCallback((device: Partial<DeviceHeld>) => {
    setConfig((c) => ({ ...c, device: { ...c.device, ...device } }));
  }, []);

  const setStarterRoleFilter = useCallback((v: StarterRoleFilter) => {
    setConfig((c) => ({ ...c, starterRoleFilter: v }));
  }, []);

  const setSkillCalibration = useCallback(
    (pokeId: string, skillName: string, skillPower: number) => {
      setConfig((c) => ({
        ...c,
        skillCalibrations: {
          ...c.skillCalibrations,
          [`${pokeId}:${skillName}`]: skillPower,
        },
      }));
    },
    []
  );

  const clearSkillCalibration = useCallback((pokeId: string, skillName: string) => {
    setConfig((c) => {
      const { [`${pokeId}:${skillName}`]: _removed, ...rest } = c.skillCalibrations;
      return { ...c, skillCalibrations: rest };
    });
  }, []);

  return {
    config,
    setPlayerLvl,
    setClan,
    setHunt,
    setMob,
    setDevice,
    setPokeSetup,
    setSkillCalibration,
    clearSkillCalibration,
    setStarterRoleFilter,
  };
}

export const POKEMON_ELEMENTS: PokemonElement[] = [
  "normal", "fire", "water", "electric", "grass", "ice",
  "fighting", "poison", "ground", "flying", "psychic", "bug",
  "rock", "ghost", "dragon", "dark", "steel", "fairy",
];
