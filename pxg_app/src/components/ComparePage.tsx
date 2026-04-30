import { useCallback, useEffect, useMemo, useState } from "react";
import type { Boss, BossCategory, Pokemon, PokemonElement, XAtkTier } from "../types";
import pokemonData from "../data/pokemon.json";
import bossesData from "../data/bosses.json";
import {
  createPokeRowCache,
  DEFAULT_HELD,
  DEFAULT_SIM_DURATION,
  pokeHasCalibratedDamage,
  X_CRITICAL_PCT_BY_TIER,
  type PokeHeld,
  type PokeRow,
} from "../engine/bossSim";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import ListSubheader from "@mui/material/ListSubheader";
import Autocomplete from "@mui/material/Autocomplete";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import CloseIcon from "@mui/icons-material/Close";
import WhatshotIcon from "@mui/icons-material/Whatshot";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";

const bosses = bossesData as Boss[];
const BOSS_CATEGORIES: BossCategory[] = ["Nightmare Terror", "Bestas Lendárias"];
const allPokes: Pokemon[] = pokemonData as Pokemon[];
const damagePokes: Pokemon[] = allPokes.filter(pokeHasCalibratedDamage);

const SELECTED_STORAGE_KEY = "pxg_compare_selected_ids"; // legacy: string[] of pokeIds
const ENTRIES_STORAGE_KEY = "pxg_compare_entries";       // novo: CompareEntry[]
const HELDS_STORAGE_KEY = "pxg_compare_helds";
const BOSS_STORAGE_KEY = "pxg_compare_boss_id";
const PLAYER_LVL_STORAGE_KEY = "pxg_compare_player_lvl"; // legacy: single number
const PLAYER_LVLS_STORAGE_KEY = "pxg_compare_player_lvls"; // novo: Record<rowId, number>
const TM_TANK_STORAGE_KEY = "pxg_compare_tm_tank";
const MANOPLA_STORAGE_KEY = "pxg_compare_manopla"; // legacy: single value
const MANOPLAS_STORAGE_KEY = "pxg_compare_manoplas"; // novo: Record<rowId, ManoplaPrimary>
const FOODS_STORAGE_KEY = "pxg_compare_foods";

const MAX_ENTRIES = 20;
const DEFAULT_PLAYER_LVL = 600;

/** Linha da tabela: rowId é único por linha (permite pokes duplicados). */
interface CompareEntry { rowId: string; pokeId: string }
const genRowId = () => `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// TM tank no time: pokes TM ganham +40%, demais +10%. Sem TM tank, ninguém ganha buff.
const TANK_MULT_NONE = 1.0;
const TANK_MULT_NON_TM = 1.1;
const TANK_MULT_TM = 1.4;
const getTankMult = (pokeTier: string, tmTank: boolean): number => {
  if (!tmTank) return TANK_MULT_NONE;
  return pokeTier === "TM" ? TANK_MULT_TM : TANK_MULT_NON_TM;
};

// Manopla: 1 slot primário (joia escolhida usa valor primário) + slots secundários
// (todas as outras joias contribuem c/ valor secundário simultaneamente). Pra dano
// só Topaz importa: +5% crit primário, +2% secundário. "Sem" = 0% crit. Crit em PxG = ×2,
// então E[dmg] c/ chance C% = dmg × (1 + C/100).
type ManoplaPrimary = "none" | "critical" | "loot" | "catch" | "block" | "speed" | "coleta-critica";
const MANOPLA_OPTIONS: { value: ManoplaPrimary; label: string }[] = [
  { value: "none", label: "Sem" },
  { value: "critical", label: "Critical" },
  { value: "loot", label: "Loot" },
  { value: "catch", label: "Catch" },
  { value: "block", label: "Block" },
  { value: "speed", label: "Speed" },
  { value: "coleta-critica", label: "Coleta Crítica" },
];
function getManoplaCritPct(primary: ManoplaPrimary): number {
  if (primary === "none") return 0;
  if (primary === "critical") return 5;
  return 2;
}
const getCritMult = (critPct: number) => 1 + critPct / 100;

// % de atk do X-Attack por tier (mesma tabela do engine, em points).
const X_ATK_PCT: Record<number, number> = { 0: 0, 1: 8, 2: 12, 3: 16, 4: 19, 5: 22, 6: 25, 7: 28, 8: 31 };
// Valor do X-Boost por tier no range lvl 400+ (range 3). Engine ajusta por player lvl real.
const X_BOOST_VALUE_400: Record<number, number> = { 0: 0, 1: 15, 2: 20, 3: 25, 4: 30, 5: 35, 6: 40, 7: 45 };

// Foods: cada poke do time pode estar comendo 1 food. Em boss fight o valor é
// dobrado pelo jogo, então as opções aqui já mostram o efeito ×2.
type FoodId = "none" | "torchic" | "combusken-beef" | "blaziken" | "celery-roll" | "sir-salad" | "elite-salad";
type FoodKind = "atk" | "crit";
interface FoodOption { value: FoodId; label: string; kind: FoodKind | null; basePct: number }
const FOOD_OPTIONS: FoodOption[] = [
  { value: "none",           label: "Sem food",           kind: null,  basePct: 0 },
  { value: "torchic",        label: "MC Torchic (atk)",   kind: "atk", basePct: 1 },
  { value: "combusken-beef", label: "Conbusken Beef (atk)", kind: "atk", basePct: 2 },
  { value: "blaziken",       label: "Mc Blaziken (atk)",  kind: "atk", basePct: 3 },
  { value: "celery-roll",    label: "Celery Roll (crit)", kind: "crit", basePct: 1 },
  { value: "sir-salad",      label: "Sir Sala'd (crit)",  kind: "crit", basePct: 2 },
  { value: "elite-salad",    label: "Elite Sala'd (crit)", kind: "crit", basePct: 3 },
];
const BOSS_FOOD_MULT = 2;
function getFoodBonuses(food: FoodId): { atkPct: number; critPct: number } {
  const opt = FOOD_OPTIONS.find((o) => o.value === food);
  if (!opt || opt.kind === null) return { atkPct: 0, critPct: 0 };
  const doubled = opt.basePct * BOSS_FOOD_MULT;
  return opt.kind === "atk" ? { atkPct: doubled, critPct: 0 } : { atkPct: 0, critPct: doubled };
}

/** Carrega entries (formato novo). Migra do formato legado (string[] de pokeIds)
 *  preservando rowId === pokeId — assim as keys de helds/foods do user antigo
 *  continuam batendo. */
function loadEntries(): CompareEntry[] {
  const valid = new Set(damagePokes.map((p) => p.id));
  const newRaw = localStorage.getItem(ENTRIES_STORAGE_KEY);
  if (newRaw) {
    try {
      const parsed = JSON.parse(newRaw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter(
            (e): e is CompareEntry =>
              e && typeof e.rowId === "string" && typeof e.pokeId === "string" && valid.has(e.pokeId)
          )
          .slice(0, MAX_ENTRIES);
      }
    } catch {
      /* fallthrough pro legacy */
    }
  }
  const legacyRaw = localStorage.getItem(SELECTED_STORAGE_KEY);
  if (legacyRaw) {
    try {
      const parsed = JSON.parse(legacyRaw);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
        return parsed
          .filter((id: string) => valid.has(id))
          .slice(0, MAX_ENTRIES)
          .map((id: string) => ({ rowId: id, pokeId: id }));
      }
    } catch {
      /* ignore */
    }
  }
  return [];
}

// Migração one-time: a OTDD page foi removida em favor da Compare. Se o usuário
// tinha helds salvos lá, copia pra compare antes de descartar a key antiga.
const LEGACY_OTDD_HELDS_KEY = "pxg_otdd_helds";

/** Migra `PokeHeld` do formato antigo pro novo. Aceita formatos:
 *  v1 (engine antigo): xAtkTier/xBoostTier/xCriticalPct
 *  v2 (intermediário): heldKind+heldTier+heldCritPct+deviceKind+deviceTier+deviceCritPct
 *  v3 (atual): heldKind+heldTier+deviceKind+deviceTier (X-Critical usa o tier direto). */
function migrateHeld(raw: unknown): PokeHeld {
  const o = (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {});
  if (typeof o.heldKind === "string" && typeof o.deviceKind === "string") {
    // v2 ou v3
    let heldTier = typeof o.heldTier === "number" ? o.heldTier : 0;
    let deviceTier = typeof o.deviceTier === "number" ? o.deviceTier : 0;
    // v2: X-Critical guardava % em deviceCritPct (0-100). v3 usa tier (0-8).
    if (o.deviceKind === "x-critical" && typeof o.deviceCritPct === "number" && deviceTier === 0) {
      deviceTier = Math.min(8, Math.max(0, Math.round(o.deviceCritPct as number)));
    }
    // Held do poke restrito a X-Attack — força kind, garante tier 1-8.
    if (heldTier < 1 || heldTier > 8) heldTier = 8;
    return {
      boost: typeof o.boost === "number" ? o.boost : DEFAULT_HELD.boost,
      heldKind: "x-attack",
      heldTier: heldTier as PokeHeld["heldTier"],
      deviceKind: o.deviceKind as PokeHeld["deviceKind"],
      deviceTier: deviceTier as PokeHeld["deviceTier"],
    };
  }
  // v1 — held do poke é forçado pra X-Attack (regra atual).
  const xAtkTier = typeof o.xAtkTier === "number" ? Math.min(8, Math.max(1, o.xAtkTier)) : 8;
  const xBoostTier = typeof o.xBoostTier === "number" ? o.xBoostTier : 0;
  const out: PokeHeld = { ...DEFAULT_HELD, boost: typeof o.boost === "number" ? o.boost : DEFAULT_HELD.boost };
  out.heldKind = "x-attack";
  out.heldTier = xAtkTier as PokeHeld["heldTier"];
  if (xBoostTier > 0) {
    out.deviceKind = "x-boost";
    out.deviceTier = xBoostTier as PokeHeld["deviceTier"];
  }
  return out;
}

function loadHelds(): Record<string, PokeHeld> {
  try {
    const raw = localStorage.getItem(HELDS_STORAGE_KEY);
    const current = raw ? JSON.parse(raw) : null;
    const currentMap = typeof current === "object" && current !== null ? current : {};

    const legacyRaw = localStorage.getItem(LEGACY_OTDD_HELDS_KEY);
    let merged: Record<string, unknown> = currentMap;
    if (legacyRaw) {
      try {
        const legacy = JSON.parse(legacyRaw);
        if (typeof legacy === "object" && legacy !== null) {
          merged = { ...legacy, ...currentMap };
        }
      } catch {
        /* ignore corrupt legacy */
      }
      localStorage.removeItem(LEGACY_OTDD_HELDS_KEY);
    }
    const out: Record<string, PokeHeld> = {};
    for (const [k, v] of Object.entries(merged)) out[k] = migrateHeld(v);
    return out;
  } catch {
    return {};
  }
}

const OTDD_POKE_IDS = damagePokes.filter((p) => p.role === "otdd").map((p) => p.id);

const fmt = (n: number) => Math.round(n).toLocaleString();

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return sec === 0 ? `${m}min` : `${m}min${String(sec).padStart(2, "0")}`;
}

const headerCellSx = {
  fontWeight: 600,
  color: "text.secondary",
  fontSize: "0.75rem",
  textTransform: "uppercase" as const,
  letterSpacing: "0.04em",
};

type SortCol = "name" | "boost" | "skills" | "melee" | "total";
type SortDir = "asc" | "desc";

/** True quando o poke tem alguma skill de dano (não-buff) sem power calibrado.
 *  Usado pra marcar comparações incompletas — total mostrado pode estar subestimado. */
function pokeHasUncalibratedSkills(poke: Pokemon): boolean {
  return poke.skills.some((s) => s.power === undefined && s.buff === null);
}

export function ComparePage() {
  const [playerLvls, setPlayerLvls] = useState<Record<string, number>>(() => {
    const raw = localStorage.getItem(PLAYER_LVLS_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null) {
          const out: Record<string, number> = {};
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
          }
          return out;
        }
      } catch {
        /* ignore */
      }
    }
    return {};
  });
  /** Default pra rows sem entrada própria: lê legacy `pxg_compare_player_lvl` (one-shot, 600 fallback). */
  const defaultPlayerLvl = useMemo(() => {
    const raw = localStorage.getItem(PLAYER_LVL_STORAGE_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_PLAYER_LVL;
  }, []);
  const [bossId, setBossId] = useState<string>(() => {
    const raw = localStorage.getItem(BOSS_STORAGE_KEY) ?? "";
    // Valida que o id ainda existe (evita stale data se boss for removido)
    return bosses.some((b) => b.id === raw) ? raw : "";
  });
  const [tmTank, setTmTank] = useState<boolean>(() => {
    return localStorage.getItem(TM_TANK_STORAGE_KEY) === "true";
  });
  const [manoplas, setManoplas] = useState<Record<string, ManoplaPrimary>>(() => {
    const raw = localStorage.getItem(MANOPLAS_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null) {
          const validIds = new Set(MANOPLA_OPTIONS.map((o) => o.value));
          const out: Record<string, ManoplaPrimary> = {};
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "string" && validIds.has(v as ManoplaPrimary)) out[k] = v as ManoplaPrimary;
          }
          return out;
        }
      } catch {
        /* ignore */
      }
    }
    return {};
  });
  /** Default pra rows sem entrada própria: lê legacy `pxg_compare_manopla` (one-shot, "none" fallback). */
  const defaultManopla = useMemo<ManoplaPrimary>(() => {
    const raw = localStorage.getItem(MANOPLA_STORAGE_KEY);
    return MANOPLA_OPTIONS.some((o) => o.value === raw) ? (raw as ManoplaPrimary) : "none";
  }, []);
  const [foods, setFoods] = useState<Record<string, FoodId>>(() => {
    try {
      const raw = localStorage.getItem(FOODS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (typeof parsed !== "object" || parsed === null) return {};
      const validIds = new Set(FOOD_OPTIONS.map((o) => o.value));
      const out: Record<string, FoodId> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string" && validIds.has(v as FoodId)) out[k] = v as FoodId;
      }
      return out;
    } catch {
      return {};
    }
  });
  const [entries, setEntries] = useState<CompareEntry[]>(loadEntries);
  const [helds, setHelds] = useState<Record<string, PokeHeld>>(loadHelds);
  const [sort, setSort] = useState<{ col: SortCol; dir: SortDir }>({ col: "total", dir: "desc" });
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(ENTRIES_STORAGE_KEY, JSON.stringify(entries));
  }, [entries]);
  useEffect(() => {
    localStorage.setItem(HELDS_STORAGE_KEY, JSON.stringify(helds));
  }, [helds]);
  useEffect(() => {
    localStorage.setItem(BOSS_STORAGE_KEY, bossId);
  }, [bossId]);
  useEffect(() => {
    localStorage.setItem(PLAYER_LVLS_STORAGE_KEY, JSON.stringify(playerLvls));
  }, [playerLvls]);
  useEffect(() => {
    localStorage.setItem(TM_TANK_STORAGE_KEY, String(tmTank));
  }, [tmTank]);
  useEffect(() => {
    localStorage.setItem(MANOPLAS_STORAGE_KEY, JSON.stringify(manoplas));
  }, [manoplas]);
  useEffect(() => {
    localStorage.setItem(FOODS_STORAGE_KEY, JSON.stringify(foods));
  }, [foods]);

  const updateFood = (rowId: string, foodId: FoodId) => {
    setFoods((prev) => ({ ...prev, [rowId]: foodId }));
  };

  const updatePlayerLvl = (rowId: string, lvl: number) => {
    setPlayerLvls((prev) => ({ ...prev, [rowId]: lvl }));
  };
  const getPlayerLvl = (rowId: string) => playerLvls[rowId] ?? defaultPlayerLvl;

  const updateManopla = (rowId: string, m: ManoplaPrimary) => {
    setManoplas((prev) => ({ ...prev, [rowId]: m }));
  };
  const getManopla = (rowId: string) => manoplas[rowId] ?? defaultManopla;

  const updateHeld = (rowId: string, patch: Partial<PokeHeld>) => {
    setHelds((prev) => ({
      ...prev,
      [rowId]: { ...DEFAULT_HELD, ...prev[rowId], ...patch },
    }));
  };

  const removeRow = (rowId: string) => {
    setEntries((prev) => prev.filter((e) => e.rowId !== rowId));
    // Limpa setup órfão pra não vazar localStorage com rowIds removidos.
    setHelds((prev) => {
      if (!(rowId in prev)) return prev;
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
    setFoods((prev) => {
      if (!(rowId in prev)) return prev;
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
    setPlayerLvls((prev) => {
      if (!(rowId in prev)) return prev;
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
    setManoplas((prev) => {
      if (!(rowId in prev)) return prev;
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
  };

  const addPoke = (poke: Pokemon | null) => {
    if (!poke) return;
    if (entries.length >= MAX_ENTRIES) return;
    setEntries((prev) => [...prev, { rowId: genRowId(), pokeId: poke.id }]);
  };

  const addOtddPreset = () => {
    setEntries((prev) => {
      const present = new Set(prev.map((e) => e.pokeId));
      const toAdd = OTDD_POKE_IDS.filter((id) => !present.has(id));
      const room = MAX_ENTRIES - prev.length;
      const limited = toAdd.slice(0, Math.max(0, room));
      return [...prev, ...limited.map((id) => ({ rowId: genRowId(), pokeId: id }))];
    });
  };

  const presentPokeIds = useMemo(() => new Set(entries.map((e) => e.pokeId)), [entries]);
  const otddAlreadyAdded = OTDD_POKE_IDS.every((id) => presentPokeIds.has(id));
  const atMaxEntries = entries.length >= MAX_ENTRIES;

  const selectedBoss = useMemo(() => bosses.find((b) => b.id === bossId), [bossId]);
  const simDuration = selectedBoss?.durationSeconds ?? DEFAULT_SIM_DURATION;

  // useState (não useRef) pra cache: identidade estável entre renders, sem ESLint
  // queixar de acesso a `.current` durante render. Mesma semântica.
  const [rowCache] = useState(() => createPokeRowCache());

  /** Linha pronta pra renderizar — PokeRow + rowId pro lookup de helds/foods/key. */
  type RenderRow = PokeRow & { rowId: string };

  const rows = useMemo<RenderRow[]>(() => {
    const targetTypes: PokemonElement[] = selectedBoss?.types ?? [];
    const result: RenderRow[] = [];
    for (const e of entries) {
      const poke = damagePokes.find((p) => p.id === e.pokeId);
      if (!poke) continue;
      const held = helds[e.rowId] ?? DEFAULT_HELD;
      const foodAtkPct = getFoodBonuses(foods[e.rowId] ?? "none").atkPct;
      const lvl = playerLvls[e.rowId] ?? defaultPlayerLvl;
      const pokeRow = rowCache.get(poke, held, lvl, targetTypes, simDuration, foodAtkPct);
      result.push({ ...pokeRow, rowId: e.rowId });
    }
    return result;
  }, [playerLvls, defaultPlayerLvl, helds, foods, selectedBoss, entries, simDuration, rowCache]);

  const getRowMult = useCallback(
    (r: RenderRow): number => {
      const foodCrit = getFoodBonuses(foods[r.rowId] ?? "none").critPct;
      const rowManoplaCrit = getManoplaCritPct(manoplas[r.rowId] ?? defaultManopla);
      const heldCrit = r.held.heldKind === "x-critical" ? X_CRITICAL_PCT_BY_TIER[r.held.heldTier] ?? 0 : 0;
      const deviceCrit = r.held.deviceKind === "x-critical" ? X_CRITICAL_PCT_BY_TIER[r.held.deviceTier] ?? 0 : 0;
      return getTankMult(r.poke.tier, tmTank) * getCritMult(rowManoplaCrit + foodCrit + heldCrit + deviceCrit);
    },
    [foods, manoplas, defaultManopla, tmTank]
  );

  const sortedRows = useMemo<RenderRow[]>(() => {
    const getValue = (r: RenderRow): string | number => {
      const m = getRowMult(r);
      switch (sort.col) {
        case "name": return r.poke.name.toLowerCase();
        case "boost": return r.held.boost;
        case "skills": return r.skillsDmg * m;
        case "melee": return r.meleeIncludedInTotal ? r.meleeDmg * m : 0;
        case "total": return r.totalDmg * m;
      }
    };
    const sorted = [...rows].sort((a, b) => {
      const av = getValue(a), bv = getValue(b);
      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [rows, sort, getRowMult]);

  const toggleSort = (col: SortCol) => {
    setSort((s) =>
      s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: col === "name" ? "asc" : "desc" }
    );
  };

  // Pokes duplicados são permitidos (até MAX_ENTRIES) — autocomplete mostra todos.
  const availableToAdd = damagePokes;

  const bossOptions = useMemo(() => {
    const items: React.ReactNode[] = [];
    items.push(
      <MenuItem key="__none" value="">
        Neutro (sem boss)
      </MenuItem>
    );
    for (const cat of BOSS_CATEGORIES) {
      // ListSubheader como categoria visual — desabilitado pra não ser clicável
      // (default do MUI Select trata subheaders como clicáveis, o que reseta a seleção).
      items.push(
        <ListSubheader key={`h-${cat}`} sx={{ pointerEvents: "none", lineHeight: 2, bgcolor: "background.default" }}>
          {cat}
        </ListSubheader>
      );
      for (const b of bosses.filter((x) => x.category === cat)) {
        items.push(
          <MenuItem key={b.id} value={b.id}>
            {b.name}
            {b.types.length > 0 ? ` (${b.types.join("/")})` : ""}
          </MenuItem>
        );
      }
    }
    return items;
  }, []);

  const durLabel = formatDuration(simDuration);
  const COLS: { id: SortCol; label: string; numeric: boolean; tooltip?: string }[] = [
    { id: "name", label: "Pokémon", numeric: false },
    { id: "boost" as SortCol, label: "Lvl", numeric: false, tooltip: "Player lvl base do char (não soma NL bonus). Default 600." },
    { id: "boost", label: "Boost", numeric: true },
    { id: "boost" as SortCol, label: "Held", numeric: false, tooltip: "X-Attack do poke (T1-T8)." },
    { id: "boost" as SortCol, label: "Device", numeric: false, tooltip: "Device do char (slot separado, 1 por char). BOOST mostra valor do range 400+ (engine ajusta por lvl); CRIT mostra % de chance." },
    { id: "boost" as SortCol, label: "Manopla", numeric: false, tooltip: "Joia primária. Pra dano só Critical importa (+5% crit). Qualquer outro = Topaz secundário (+2%). \"Sem\" = 0%." },
    { id: "boost" as SortCol, label: "Food", numeric: false, tooltip: "Atk: somado ao Σ atk%. Crit: somado ao crit %. Em boss o valor é ×2." },
    { id: "skills", label: `Skills/${durLabel}`, numeric: true },
    { id: "melee", label: `Melee/${durLabel}`, numeric: true, tooltip: "Apenas ranged conta no total. Close (italic) é informativo." },
    { id: "total", label: `Total/${durLabel}`, numeric: true },
  ];

  return (
    <Box sx={{ py: 2 }}>
      <Typography variant="h2" sx={{ mb: 1 }}>
        Dano em boss fight
      </Typography>
      <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mb: 3, lineHeight: 1.6 }}>
        Adicione pokes pra comparar dano vs um boss (ou alvo neutro). Apenas pokes com dano calibrado disponíveis.
        Janela default 10min — bosses com timer próprio sobrescrevem (Raito e Kitsune 7min30).
        <Box component="span" sx={{ display: "block", mt: 0.5 }}>
          ⚠ <strong>Bônus de clã é ignorado em boss</strong> (mecânica do jogo) — o cálculo aqui força clã = neutro mesmo
          que o poke pertença a um clã com bônus pro elemento da skill.
        </Box>
        <Box component="span" sx={{ display: "block", mt: 0.5 }}>
          Buffs (Rage ×2/20s, etc.) não modelados — valores são baseline sem buff.
        </Box>
      </Typography>

      <Paper sx={{ p: 2.5, mb: 2 }}>
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center" }}>
          <TextField
            select
            label="Boss"
            size="small"
            value={bossId}
            onChange={(e) => setBossId(e.target.value)}
            sx={{ minWidth: 280 }}
          >
            {bossOptions}
          </TextField>
          <Tooltip title="Marque se o time tem TM tank no boss. Quando marcado: pokes TM ganham +40%, demais +10%. Desmarcado: nenhum buff." arrow placement="top">
            <FormControlLabel
              control={<Checkbox size="small" checked={tmTank} onChange={(e) => setTmTank(e.target.checked)} />}
              label="TM tank"
              sx={{ m: 0 }}
            />
          </Tooltip>
          <Autocomplete
            size="small"
            options={availableToAdd}
            getOptionLabel={(p) => p.name}
            value={null}
            onChange={(_, v) => addPoke(v)}
            disabled={atMaxEntries}
            sx={{ minWidth: 280, flex: 1 }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Adicionar pokémon"
                placeholder={
                  atMaxEntries
                    ? `Limite ${MAX_ENTRIES} atingido`
                    : `${entries.length}/${MAX_ENTRIES} • duplicatas permitidas`
                }
              />
            )}
            renderOption={(props, p) => {
              const { key, ...rest } = props as { key: string } & React.HTMLAttributes<HTMLLIElement>;
              return (
                <li key={key} {...rest}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
                    <Typography sx={{ flex: 1 }}>{p.name}</Typography>
                    <Chip
                      label={p.tier}
                      size="small"
                      variant="outlined"
                      sx={{ height: 18, fontSize: "0.65rem", fontWeight: 700 }}
                    />
                  </Box>
                </li>
              );
            }}
          />
          {OTDD_POKE_IDS.length > 0 && (
            <Tooltip
              title={
                otddAlreadyAdded
                  ? "Todos os OTDD já adicionados"
                  : atMaxEntries
                    ? `Limite ${MAX_ENTRIES} atingido`
                    : `Adiciona ${OTDD_POKE_IDS.length} pokes com role OTDD`
              }
              arrow
            >
              <span>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<WhatshotIcon />}
                  onClick={addOtddPreset}
                  disabled={otddAlreadyAdded || atMaxEntries}
                  sx={{ whiteSpace: "nowrap" }}
                >
                  + OTDD
                </Button>
              </span>
            </Tooltip>
          )}
        </Box>
      </Paper>

      <Paper sx={{ p: 2.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5, flexWrap: "wrap", gap: 1 }}>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.5, flexWrap: "wrap" }}>
            <Typography variant="h2" sx={{ m: 0 }}>
              Comparação
            </Typography>
            <Typography variant="caption" sx={{ color: "text.disabled" }}>
              {entries.length}/{MAX_ENTRIES} {entries.length === 1 ? "poke" : "pokes"}
              {selectedBoss ? ` vs ${selectedBoss.name}${selectedBoss.types.length > 0 ? ` (${selectedBoss.types.join("/")})` : ""}` : " — alvo neutro"}
            </Typography>
          </Box>
          {entries.length > 0 && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              {copyFeedback && (
                <Typography variant="caption" sx={{ color: "success.main", fontWeight: 600 }}>
                  {copyFeedback}
                </Typography>
              )}
              <Tooltip title="Copia a tabela em formato texto pro clipboard" arrow>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<ContentCopyIcon fontSize="small" />}
                  onClick={async () => {
                    const lines: string[] = [];
                    lines.push(`=== PxG Damage Planner — Comparação ===`);
                    lines.push(`Boss: ${selectedBoss ? `${selectedBoss.name}${selectedBoss.types.length > 0 ? ` (${selectedBoss.types.join("/")})` : ""}` : "Neutro (sem boss)"}`);
                    lines.push(`Janela: ${durLabel}`);
                    lines.push(`Tank: ${tmTank ? "TM Tank (TM pokes +40%, demais +10%)" : "Sem TM tank"}`);
                    lines.push(`Pokes: ${sortedRows.length}`);
                    lines.push("");
                    lines.push(`Pokémon                  Lvl   Boost  Held          Device           Manopla    Food                 Skills/${durLabel}   Melee/${durLabel}   Total/${durLabel}`);
                    for (const row of sortedRows) {
                      const m = getRowMult(row);
                      const heldStr = `ATK ${row.held.heldTier} (${X_ATK_PCT[row.held.heldTier] ?? 0}%)`;
                      const deviceStr = row.held.deviceKind === "none"
                        ? "—"
                        : row.held.deviceKind === "x-critical"
                          ? `CRIT ${row.held.deviceTier} (${X_CRITICAL_PCT_BY_TIER[row.held.deviceTier] ?? 0}%)`
                          : `BOOST ${row.held.deviceTier} (+${X_BOOST_VALUE_400[row.held.deviceTier] ?? 0})`;
                      const foodOpt = FOOD_OPTIONS.find((o) => o.value === (foods[row.rowId] ?? "none"));
                      const foodStr = foodOpt && foodOpt.basePct > 0
                        ? `${foodOpt.label.replace(/\s+\(.+\)$/, "")} +${foodOpt.basePct * BOSS_FOOD_MULT}%`
                        : "—";
                      const meleeStr = row.meleeDmg > 0
                        ? `${fmt(row.meleeDmg * m)}${!row.meleeIncludedInTotal ? " (close)" : ""}`
                        : "—";
                      const uncal = pokeHasUncalibratedSkills(row.poke) ? " ⚠" : "";
                      const lvlStr = String(getPlayerLvl(row.rowId));
                      const manoplaOpt = MANOPLA_OPTIONS.find((o) => o.value === getManopla(row.rowId));
                      const manoplaStr = manoplaOpt?.label ?? "Sem";
                      lines.push(
                        `${(row.poke.name + uncal).padEnd(24)} ${lvlStr.padEnd(5)} ${("+" + row.held.boost).padEnd(6)} ${heldStr.padEnd(13)} ${deviceStr.padEnd(16)} ${manoplaStr.padEnd(10)} ${foodStr.padEnd(20)} ${fmt(row.skillsDmg * m).padStart(13)} ${meleeStr.padStart(15)} ${fmt(row.totalDmg * m).padStart(15)}`
                      );
                    }
                    if (sortedRows.some((r) => pokeHasUncalibratedSkills(r.poke))) {
                      lines.push("");
                      lines.push("⚠ = poke tem skills sem dano calibrado — total pode estar subestimado.");
                    }
                    try {
                      await navigator.clipboard.writeText(lines.join("\n"));
                      setCopyFeedback("Copiado!");
                    } catch {
                      setCopyFeedback("Falha");
                    }
                    setTimeout(() => setCopyFeedback(null), 2000);
                  }}
                >
                  Copiar
                </Button>
              </Tooltip>
            </Box>
          )}
        </Box>

        {entries.length === 0 ? (
          <Typography variant="body2" sx={{ color: "text.disabled", py: 4, textAlign: "center" }}>
            Adicione pokes acima pra ver a comparação.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small" sx={{ "& td, & th": { borderColor: "divider" } }}>
              <TableHead>
                <TableRow>
                  {COLS.map((col, idx) => {
                    const cell = (
                      <TableCell
                        key={`${col.label}-${idx}`}
                        align={col.numeric ? "right" : "left"}
                        sx={headerCellSx}
                      >
                        {col.label === "Lvl" || col.label === "Held" || col.label === "Device" || col.label === "Manopla" || col.label === "Food" ? (
                          col.label
                        ) : (
                          <TableSortLabel
                            active={sort.col === col.id}
                            direction={sort.col === col.id ? sort.dir : "asc"}
                            onClick={() => toggleSort(col.id)}
                          >
                            {col.label}
                          </TableSortLabel>
                        )}
                      </TableCell>
                    );
                    return col.tooltip ? (
                      <Tooltip key={`tt-${idx}`} title={col.tooltip} arrow>{cell}</Tooltip>
                    ) : cell;
                  })}
                  <TableCell sx={{ ...headerCellSx, width: 36 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedRows.map((row) => {
                  const deviceKind = row.held.deviceKind;
                  // Held do poke: somente X-Attack T1-T8.
                  const heldTierOptions: XAtkTier[] = [1, 2, 3, 4, 5, 6, 7, 8];
                  // Device combinado kind+tier num único select (string token).
                  const deviceValue =
                    deviceKind === "none" ? "none"
                      : deviceKind === "x-boost" ? `boost-${row.held.deviceTier}`
                      : `crit-${row.held.deviceTier}`;

                  const uncalibrated = pokeHasUncalibratedSkills(row.poke);
                  const tankMult = getRowMult(row);
                  const rowFood = foods[row.rowId] ?? "none";
                  const rowManopla = getManopla(row.rowId);

                  return (
                    <TableRow key={row.rowId} hover>
                      <TableCell sx={{ fontWeight: 500 }}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                          {row.poke.name}
                          {uncalibrated && (
                            <Tooltip
                              title="⚠ Este poke tem skills sem dano calibrado — o total mostrado pode estar subestimado (ignorar essas skills)."
                              placement="top"
                              arrow
                            >
                              <Typography component="span" sx={{ color: "warning.main", cursor: "help", fontSize: "1rem", lineHeight: 1 }}>⚠</Typography>
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        <TextField
                          type="number"
                          size="small"
                          value={getPlayerLvl(row.rowId)}
                          onChange={(e) => updatePlayerLvl(row.rowId, Number(e.target.value) || 0)}
                          slotProps={{ htmlInput: { min: 1, max: 1000 } }}
                          sx={{ width: 80, "& input": { textAlign: "right" } }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <TextField
                          type="number"
                          size="small"
                          value={row.held.boost}
                          onChange={(e) => updateHeld(row.rowId, { boost: Number(e.target.value) || 0 })}
                          slotProps={{ htmlInput: { min: 0, max: 150 } }}
                          sx={{ width: 80, "& input": { textAlign: "right" } }}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          select
                          size="small"
                          value={Math.max(1, Math.min(8, row.held.heldTier)) as XAtkTier}
                          onChange={(e) =>
                            updateHeld(row.rowId, { heldKind: "x-attack", heldTier: Number(e.target.value) as XAtkTier })
                          }
                          sx={{ minWidth: 90 }}
                        >
                          {heldTierOptions.map((t) => (
                            <MenuItem key={t} value={t}>{`ATK ${t} (${X_ATK_PCT[t]}%)`}</MenuItem>
                          ))}
                        </TextField>
                      </TableCell>
                      <TableCell>
                        <TextField
                          select
                          size="small"
                          value={deviceValue}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "none") {
                              updateHeld(row.rowId, { deviceKind: "none", deviceTier: 0 });
                            } else if (v.startsWith("boost-")) {
                              const tier = Number(v.slice(6)) as XAtkTier;
                              updateHeld(row.rowId, { deviceKind: "x-boost", deviceTier: tier });
                            } else if (v.startsWith("crit-")) {
                              const tier = Number(v.slice(5)) as XAtkTier;
                              updateHeld(row.rowId, { deviceKind: "x-critical", deviceTier: tier });
                            }
                          }}
                          sx={{ minWidth: 160 }}
                        >
                          <MenuItem value="none">Sem device</MenuItem>
                          <ListSubheader sx={{ pointerEvents: "none", lineHeight: 2, bgcolor: "background.default" }}>X-Boost</ListSubheader>
                          {[1, 2, 3, 4, 5, 6, 7].map((t) => (
                            <MenuItem key={`boost-${t}`} value={`boost-${t}`}>{`BOOST ${t} (+${X_BOOST_VALUE_400[t]})`}</MenuItem>
                          ))}
                          <ListSubheader sx={{ pointerEvents: "none", lineHeight: 2, bgcolor: "background.default" }}>X-Critical</ListSubheader>
                          {[1, 2, 3, 4, 5, 6, 7, 8].map((t) => (
                            <MenuItem key={`crit-${t}`} value={`crit-${t}`}>{`CRIT ${t} (${X_CRITICAL_PCT_BY_TIER[t as XAtkTier]}%)`}</MenuItem>
                          ))}
                        </TextField>
                      </TableCell>
                      <TableCell>
                        <TextField
                          select
                          size="small"
                          value={rowManopla}
                          onChange={(e) => updateManopla(row.rowId, e.target.value as ManoplaPrimary)}
                          sx={{ minWidth: 130 }}
                        >
                          {MANOPLA_OPTIONS.map((o) => (
                            <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                          ))}
                        </TextField>
                      </TableCell>
                      <TableCell>
                        <TextField
                          select
                          size="small"
                          value={rowFood}
                          onChange={(e) => updateFood(row.rowId, e.target.value as FoodId)}
                          sx={{ minWidth: 160 }}
                        >
                          {FOOD_OPTIONS.map((o) => (
                            <MenuItem key={o.value} value={o.value}>
                              {o.label}{o.basePct > 0 ? ` +${o.basePct * BOSS_FOOD_MULT}%` : ""}
                            </MenuItem>
                          ))}
                        </TextField>
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                        {fmt(row.skillsDmg * tankMult)}
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{
                          fontVariantNumeric: "tabular-nums",
                          fontStyle: !row.meleeIncludedInTotal && row.meleeDmg > 0 ? "italic" : "normal",
                          color: !row.meleeIncludedInTotal && row.meleeDmg > 0 ? "text.disabled" : "text.primary",
                        }}
                      >
                        {row.meleeDmg > 0 ? `${fmt(row.meleeDmg * tankMult)}${!row.meleeIncludedInTotal ? " (close)" : ""}` : "—"}
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "secondary.main" }}>
                        {fmt(row.totalDmg * tankMult)}
                      </TableCell>
                      <TableCell sx={{ width: 36, p: 0.5 }}>
                        <Tooltip title="Remover" arrow>
                          <IconButton size="small" onClick={() => removeRow(row.rowId)} sx={{ color: "text.disabled", "&:hover": { color: "error.main" } }}>
                            <CloseIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Box>
  );
}
