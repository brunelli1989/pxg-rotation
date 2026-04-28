import { useEffect, useMemo, useRef, useState } from "react";
import type { Boss, BossCategory, Pokemon, PokemonElement, XAtkTier } from "../types";
import pokemonData from "../data/pokemon.json";
import bossesData from "../data/bosses.json";
import {
  createPokeRowCache,
  DEFAULT_HELD,
  pokeHasCalibratedDamage,
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
import CloseIcon from "@mui/icons-material/Close";
import WhatshotIcon from "@mui/icons-material/Whatshot";

const bosses = bossesData as Boss[];
const BOSS_CATEGORIES: BossCategory[] = ["Nightmare Terror", "Bestas Lendárias"];
const allPokes: Pokemon[] = pokemonData as Pokemon[];
const damagePokes: Pokemon[] = allPokes.filter(pokeHasCalibratedDamage);

const SELECTED_STORAGE_KEY = "pxg_compare_selected_ids";
const HELDS_STORAGE_KEY = "pxg_compare_helds";

function loadSelectedIds(): string[] {
  const raw = localStorage.getItem(SELECTED_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      const valid = new Set(damagePokes.map((p) => p.id));
      return parsed.filter((id) => valid.has(id));
    }
  } catch {
    /* ignore */
  }
  return [];
}

// Migração one-time: a OTDD page foi removida em favor da Compare. Se o usuário
// tinha helds salvos lá, copia pra compare antes de descartar a key antiga.
const LEGACY_OTDD_HELDS_KEY = "pxg_otdd_helds";

function loadHelds(): Record<string, PokeHeld> {
  try {
    const raw = localStorage.getItem(HELDS_STORAGE_KEY);
    const current = raw ? JSON.parse(raw) : null;
    const currentMap = typeof current === "object" && current !== null ? current : {};

    const legacyRaw = localStorage.getItem(LEGACY_OTDD_HELDS_KEY);
    if (legacyRaw) {
      try {
        const legacy = JSON.parse(legacyRaw);
        if (typeof legacy === "object" && legacy !== null) {
          // Compare wins on conflict — usuário já interagiu com Compare é mais recente
          const merged = { ...legacy, ...currentMap };
          localStorage.setItem(HELDS_STORAGE_KEY, JSON.stringify(merged));
          localStorage.removeItem(LEGACY_OTDD_HELDS_KEY);
          return merged;
        }
      } catch {
        /* ignore corrupt legacy */
      }
      localStorage.removeItem(LEGACY_OTDD_HELDS_KEY);
    }
    return currentMap;
  } catch {
    return {};
  }
}

const OTDD_POKE_IDS = damagePokes.filter((p) => p.role === "otdd").map((p) => p.id);

const fmt = (n: number) => Math.round(n).toLocaleString();

const headerCellSx = {
  fontWeight: 600,
  color: "text.secondary",
  fontSize: "0.75rem",
  textTransform: "uppercase" as const,
  letterSpacing: "0.04em",
};

type SortCol = "name" | "tier" | "boost" | "skills" | "melee" | "total";
type SortDir = "asc" | "desc";

const TIER_ORDER: Record<string, number> = { T1A: 0, T1B: 1, T1H: 2, T1C: 3, T2: 4, T3: 5, TM: 6, TR: 7 };

export function ComparePage() {
  const [playerLvl, setPlayerLvl] = useState(600);
  const [bossId, setBossId] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<string[]>(loadSelectedIds);
  const [helds, setHelds] = useState<Record<string, PokeHeld>>(loadHelds);
  const [sort, setSort] = useState<{ col: SortCol; dir: SortDir }>({ col: "total", dir: "desc" });

  useEffect(() => {
    localStorage.setItem(SELECTED_STORAGE_KEY, JSON.stringify(selectedIds));
  }, [selectedIds]);
  useEffect(() => {
    localStorage.setItem(HELDS_STORAGE_KEY, JSON.stringify(helds));
  }, [helds]);

  const updateHeld = (pokeId: string, patch: Partial<PokeHeld>) => {
    setHelds((prev) => ({
      ...prev,
      [pokeId]: { ...DEFAULT_HELD, ...prev[pokeId], ...patch },
    }));
  };

  const removePoke = (id: string) => {
    setSelectedIds((prev) => prev.filter((x) => x !== id));
  };

  const addPoke = (poke: Pokemon | null) => {
    if (!poke || selectedIds.includes(poke.id)) return;
    setSelectedIds((prev) => [...prev, poke.id]);
  };

  const addOtddPreset = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of OTDD_POKE_IDS) next.add(id);
      return Array.from(next);
    });
  };

  const otddAlreadyAdded = OTDD_POKE_IDS.every((id) => selectedIds.includes(id));

  const selectedBoss = useMemo(() => bosses.find((b) => b.id === bossId), [bossId]);

  const rowCache = useRef(createPokeRowCache());

  const rows = useMemo<PokeRow[]>(() => {
    const targetTypes: PokemonElement[] = selectedBoss?.types ?? [];
    const result: PokeRow[] = [];
    for (const id of selectedIds) {
      const poke = damagePokes.find((p) => p.id === id);
      if (!poke) continue;
      const held = helds[id] ?? DEFAULT_HELD;
      result.push(rowCache.current.get(poke, held, playerLvl, targetTypes));
    }
    return result;
  }, [playerLvl, helds, selectedBoss, selectedIds]);

  const sortedRows = useMemo<PokeRow[]>(() => {
    const getValue = (r: PokeRow): string | number => {
      switch (sort.col) {
        case "name": return r.poke.name.toLowerCase();
        case "tier": return TIER_ORDER[r.poke.tier] ?? 99;
        case "boost": return r.held.boost;
        case "skills": return r.skillsDmg;
        case "melee": return r.meleeIncludedInTotal ? r.meleeDmg : 0;
        case "total": return r.totalDmg;
      }
    };
    const sorted = [...rows].sort((a, b) => {
      const av = getValue(a), bv = getValue(b);
      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [rows, sort]);

  const toggleSort = (col: SortCol) => {
    setSort((s) =>
      s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: col === "name" ? "asc" : "desc" }
    );
  };

  const availableToAdd = useMemo(() => damagePokes.filter((p) => !selectedIds.includes(p.id)), [selectedIds]);

  const bossOptions = useMemo(() => {
    const items: React.ReactNode[] = [];
    items.push(
      <MenuItem key="__none" value="">
        Neutro (sem boss)
      </MenuItem>
    );
    for (const cat of BOSS_CATEGORIES) {
      items.push(<ListSubheader key={`h-${cat}`}>{cat}</ListSubheader>);
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

  const COLS: { id: SortCol; label: string; numeric: boolean; tooltip?: string }[] = [
    { id: "name", label: "Pokémon", numeric: false },
    { id: "tier", label: "Tier", numeric: false },
    { id: "boost", label: "Boost", numeric: true },
    { id: "boost" as SortCol, label: "X-Held", numeric: false },
    { id: "boost" as SortCol, label: "Tier held", numeric: false },
    { id: "skills", label: "Skills/10m", numeric: true },
    { id: "melee", label: "Melee/10m", numeric: true, tooltip: "Apenas ranged conta no total. Close (italic) é informativo." },
    { id: "total", label: "Total/10m", numeric: true },
  ];

  return (
    <Box sx={{ py: 2 }}>
      <Typography variant="h2" sx={{ mb: 1 }}>
        Comparar — Dano em 10 min
      </Typography>
      <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mb: 3, lineHeight: 1.6 }}>
        Adicione pokes pra comparar dano em 10min vs um boss (ou alvo neutro). Apenas pokes com dano calibrado disponíveis.
        Bônus de clã não se aplica em boss. Buffs (Rage ×2/20s) não modelados.
      </Typography>

      <Paper sx={{ p: 2.5, mb: 2 }}>
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center" }}>
          <TextField
            label="Player lvl"
            type="number"
            size="small"
            value={playerLvl}
            onChange={(e) => setPlayerLvl(Number(e.target.value) || 0)}
            slotProps={{ htmlInput: { min: 1, max: 1000 } }}
            sx={{ width: 120 }}
          />
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
          <Autocomplete
            size="small"
            options={availableToAdd}
            getOptionLabel={(p) => p.name}
            value={null}
            onChange={(_, v) => addPoke(v)}
            disabled={availableToAdd.length === 0}
            sx={{ minWidth: 280, flex: 1 }}
            renderInput={(params) => (
              <TextField {...params} label="Adicionar pokémon" placeholder={`${availableToAdd.length} disponíveis`} />
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
              title={otddAlreadyAdded ? "Todos os OTDD já adicionados" : `Adiciona ${OTDD_POKE_IDS.length} pokes com role OTDD`}
              arrow
            >
              <span>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<WhatshotIcon />}
                  onClick={addOtddPreset}
                  disabled={otddAlreadyAdded}
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
        <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", mb: 1.5, flexWrap: "wrap", gap: 1 }}>
          <Typography variant="h2" sx={{ m: 0 }}>
            Comparação
          </Typography>
          <Typography variant="caption" sx={{ color: "text.disabled" }}>
            {selectedIds.length} {selectedIds.length === 1 ? "poke" : "pokes"}
            {selectedBoss ? ` vs ${selectedBoss.name}${selectedBoss.types.length > 0 ? ` (${selectedBoss.types.join("/")})` : ""}` : " — alvo neutro"}
          </Typography>
        </Box>

        {selectedIds.length === 0 ? (
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
                        {col.label === "X-Held" || col.label === "Tier held" ? (
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
                  const xBoostActive = row.held.xBoostTier > 0;
                  const heldKindValue = xBoostActive ? "x-boost" : "x-attack";
                  const heldTierValue = xBoostActive ? row.held.xBoostTier : row.held.xAtkTier;
                  const tierOptions: XAtkTier[] = xBoostActive ? [1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3, 4, 5, 6, 7, 8];

                  return (
                    <TableRow key={row.poke.id} hover>
                      <TableCell sx={{ fontWeight: 500 }}>{row.poke.name}</TableCell>
                      <TableCell>
                        <Chip
                          label={row.poke.tier}
                          size="small"
                          variant="outlined"
                          sx={{ height: 20, fontSize: "0.7rem", fontWeight: 700 }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <TextField
                          type="number"
                          size="small"
                          value={row.held.boost}
                          onChange={(e) => updateHeld(row.poke.id, { boost: Number(e.target.value) || 0 })}
                          slotProps={{ htmlInput: { min: 0, max: 150 } }}
                          sx={{ width: 80, "& input": { textAlign: "right" } }}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          select
                          size="small"
                          value={heldKindValue}
                          onChange={(e) => {
                            const kind = e.target.value;
                            if (kind === "x-attack") {
                              updateHeld(row.poke.id, { xAtkTier: (row.held.xAtkTier || 8) as XAtkTier, xBoostTier: 0 });
                            } else {
                              updateHeld(row.poke.id, { xBoostTier: (row.held.xBoostTier || 4) as XAtkTier, xAtkTier: 0 });
                            }
                          }}
                          sx={{ minWidth: 110 }}
                        >
                          <MenuItem value="x-attack">X-Attack</MenuItem>
                          <MenuItem value="x-boost">X-Boost</MenuItem>
                        </TextField>
                      </TableCell>
                      <TableCell>
                        <TextField
                          select
                          size="small"
                          value={heldTierValue}
                          onChange={(e) => {
                            const tier = Number(e.target.value) as XAtkTier;
                            if (xBoostActive) updateHeld(row.poke.id, { xBoostTier: tier });
                            else updateHeld(row.poke.id, { xAtkTier: tier });
                          }}
                          sx={{ minWidth: 80 }}
                        >
                          {tierOptions.map((t) => (
                            <MenuItem key={t} value={t}>{t === 0 ? "—" : `T${t}`}</MenuItem>
                          ))}
                        </TextField>
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                        {fmt(row.skillsDmg)}
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{
                          fontVariantNumeric: "tabular-nums",
                          fontStyle: !row.meleeIncludedInTotal && row.meleeDmg > 0 ? "italic" : "normal",
                          color: !row.meleeIncludedInTotal && row.meleeDmg > 0 ? "text.disabled" : "text.primary",
                        }}
                      >
                        {row.meleeDmg > 0 ? `${fmt(row.meleeDmg)}${!row.meleeIncludedInTotal ? " (close)" : ""}` : "—"}
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "secondary.main" }}>
                        {fmt(row.totalDmg)}
                      </TableCell>
                      <TableCell sx={{ width: 36, p: 0.5 }}>
                        <Tooltip title="Remover" arrow>
                          <IconButton size="small" onClick={() => removePoke(row.poke.id)} sx={{ color: "text.disabled", "&:hover": { color: "error.main" } }}>
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
