import type {
  ClanName,
  DamageConfig,
  DiskLevel,
  HuntLevel,
  MobConfig,
  MobEntry,
  DeviceHeld,
  DeviceHeldKind,
  XAtkTier,
} from "../types";
import clansData from "../data/clans.json";
import mobsData from "../data/mobs.json";
import { DEFAULT_MOB_DEF_FACTOR, resolveMobConfig } from "../engine/damage";
import type { MobFieldSource, ResolvedMob } from "../engine/damage";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Link from "@mui/material/Link";
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

const mobs = mobsData as MobEntry[];
// Lookup por id (não name) pra suportar mobs com nome duplicado em hunts diferentes
// (ex: 4× "Shiny Druddigon" em groups diferentes).
const resolvedById = new Map<string, ResolvedMob>(
  mobs.map((m) => [m.id, resolveMobConfig(m, mobs)])
);

const TIERS: XAtkTier[] = [0, 1, 2, 3, 4, 5, 6, 7, 8];

const SOURCE_RANK: Record<MobFieldSource, number> = {
  measured: 0,
  group: 1,
  "hunt-avg": 2,
  default: 3,
};
const SOURCE_ICON: Record<MobFieldSource, string> = {
  measured: "🟢",
  group: "🟡",
  "hunt-avg": "🟠",
  default: "🔴",
};
const SOURCE_LABEL: Record<MobFieldSource, string> = {
  measured: "medido no jogo",
  group: "derivado do grupo (~1% erro)",
  "hunt-avg": "média do tier (~15% erro)",
  default: `fallback ${DEFAULT_MOB_DEF_FACTOR} (~20% erro)`,
};

const DISK_OPTIONS: { level: DiskLevel; label: string }[] = [
  { level: 0, label: "Sem Disco" },
  { level: 1, label: "Disk 1.0 (1s/8s)" },
  { level: 2, label: "Disk 2.0 (1s/6s)" },
  { level: 3, label: "Disk 3.0 (1s/4s)" },
  { level: 4, label: "Disk 4.0 (1s/3s)" },
];

function worstSource(a: MobFieldSource, b: MobFieldSource): MobFieldSource {
  return SOURCE_RANK[a] >= SOURCE_RANK[b] ? a : b;
}

function entrySource(m: MobEntry): MobFieldSource {
  const r = resolvedById.get(m.id);
  return r ? worstSource(r.hpSource, r.defSource) : "default";
}

function mobMarker(entries: MobEntry[]): string {
  const worst = entries.map(entrySource).reduce(worstSource);
  return " " + SOURCE_ICON[worst];
}

interface Props {
  config: DamageConfig;
  diskLevel: DiskLevel;
  onPlayerLvlChange: (v: number) => void;
  onClanChange: (v: ClanName | null) => void;
  onHuntChange: (v: HuntLevel) => void;
  onMobChange: (mob: Partial<MobConfig>) => void;
  onDeviceChange: (device: Partial<DeviceHeld>) => void;
  onUseElixirAtkChange: (v: boolean) => void;
  onReviveChange: (v: "none" | "normal" | "superior") => void;
  onDiskLevelChange: (v: DiskLevel) => void;
}

const sectionLabelSx = {
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "primary.light",
  textTransform: "uppercase" as const,
  letterSpacing: "0.1em",
  mb: 1.5,
  display: "block",
};

const fieldGridSx = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 2,
};

export function DamageConfigPanel({
  config,
  diskLevel,
  onPlayerLvlChange,
  onClanChange,
  onHuntChange,
  onMobChange,
  onDeviceChange,
  onUseElixirAtkChange,
  onReviveChange,
  onDiskLevelChange,
}: Props) {
  const mobsForHunt = mobs
    .filter((m) => m.hunt === config.hunt)
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));

  const groupedMobs = mobsForHunt.reduce<Record<string, MobEntry[]>>((acc, m) => {
    (acc[m.group] ??= []).push(m);
    return acc;
  }, {});

  const handleMobSelect = (groupName: string) => {
    if (groupName === "__custom__") {
      onMobChange({ name: config.mob.name });
      return;
    }
    const groupMobs = groupedMobs[groupName];
    if (!groupMobs || groupMobs.length === 0) return;

    const hardest = groupMobs
      .map((m) => resolvedById.get(m.id)!)
      .reduce((best, cur) => {
        const eff = (r: ResolvedMob) => r.hp / (r.defFactor ?? DEFAULT_MOB_DEF_FACTOR);
        return eff(cur) > eff(best) ? cur : best;
      });

    const groupDisplayName = groupMobs.length > 1 ? groupName : hardest.name;

    onMobChange({
      name: groupDisplayName,
      types: hardest.types,
      hp: hardest.hp,
      defFactor: hardest.defFactor,
      bestStarterElements: hardest.bestStarterElements,
    });
  };

  const currentGroup = Object.entries(groupedMobs).find(([groupName, groupMobs]) => {
    if (groupMobs.length > 1) return groupName === config.mob.name;
    return groupMobs[0].name === config.mob.name;
  });
  const currentSelectionKey = currentGroup ? currentGroup[0] : "__custom__";

  const type1 = config.mob.types[0] ?? "—";
  const type2 = config.mob.types[1] ?? "—";

  const selectedGroupMobs = currentGroup ? currentGroup[1] : [];
  const maxHpInGroup = selectedGroupMobs.reduce((max, m) => Math.max(max, m.hp ?? 0), 0);
  const maxHpMob = selectedGroupMobs.find((m) => m.hp === maxHpInGroup);

  const mobDisplay = (m: MobEntry) =>
    `${m.name} (${m.types.join("/")})${mobMarker([m])}`;

  // Source quality do mob alvo: para multi-mob groups (config.mob.name = group name),
  // pega a pior source dos mobs do grupo (mais conservador).
  const currentMobSource = selectedGroupMobs.length > 0
    ? selectedGroupMobs.map(entrySource).reduce(worstSource)
    : null;

  const sourceLegend = (
    <Box sx={{ p: 1.5, minWidth: 240 }}>
      <Typography variant="caption" sx={{ fontWeight: 600, mb: 1, display: "block" }}>
        Qualidade dos dados:
      </Typography>
      {(Object.entries(SOURCE_ICON) as [MobFieldSource, string][]).map(([src, icon]) => (
        <Box key={src} sx={{ display: "flex", gap: 1, mb: 0.5 }}>
          <Typography variant="caption">{icon}</Typography>
          <Typography variant="caption">{SOURCE_LABEL[src]}</Typography>
        </Box>
      ))}
    </Box>
  );

  return (
    <Paper sx={{ p: 3, mt: 3 }}>
      <Typography variant="h2" sx={{ mb: 3 }}>Configuração de Dano</Typography>

      {/* === PLAYER === */}
      <Typography sx={sectionLabelSx}>Player</Typography>
      <Box sx={fieldGridSx}>
        <Tooltip title="Nível BASE do char (ignorar o (+X) do Nightmare Level Bonus — NL não afeta dano, só HP/def). Validado empiricamente com char Orebound 369(+48) vs Volcanic 600(+0).">
          <TextField
            label="Player lvl (base)"
            type="number"
            size="small"
            value={config.playerLvl}
            onChange={(e) => onPlayerLvlChange(Number(e.target.value))}
            slotProps={{ htmlInput: { min: 1, max: 600 } }}
          />
        </Tooltip>

        <TextField
          select
          label="Clã"
          size="small"
          value={config.clan ?? ""}
          onChange={(e) => onClanChange((e.target.value || null) as ClanName | null)}
        >
          <MenuItem value="">Nenhum</MenuItem>
          {clansData.map((c) => (
            <MenuItem key={c.name} value={c.name}>
              {c.displayName} ({c.bonuses.map((b) => `+${Math.round(b.atk * 100)}% ${b.element}`).join(", ")})
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          label="Held do device"
          size="small"
          value={config.device.kind}
          onChange={(e) => onDeviceChange({ kind: e.target.value as DeviceHeldKind })}
        >
          <MenuItem value="none">Nenhum</MenuItem>
          <MenuItem value="x-attack">X-Attack</MenuItem>
          <MenuItem value="x-boost">X-Boost</MenuItem>
          <MenuItem value="x-critical">X-Critical</MenuItem>
          <MenuItem value="x-defense">X-Defense</MenuItem>
        </TextField>

        <TextField
          select
          label="Tier do device"
          size="small"
          value={config.device.tier}
          disabled={config.device.kind === "none"}
          onChange={(e) => onDeviceChange({ tier: Number(e.target.value) as XAtkTier })}
        >
          {TIERS.filter((t) => (config.device.kind === "x-boost" ? t <= 7 : true)).map((t) => (
            <MenuItem key={t} value={t}>{t === 0 ? "—" : `T${t}`}</MenuItem>
          ))}
        </TextField>

        <TextField
          select
          label="Nightmare Disk"
          size="small"
          value={diskLevel}
          onChange={(e) => onDiskLevelChange(Number(e.target.value) as DiskLevel)}
        >
          {DISK_OPTIONS.map((opt) => (
            <MenuItem key={opt.level} value={opt.level}>{opt.label}</MenuItem>
          ))}
        </TextField>
      </Box>

      <Divider sx={{ my: 3 }} />

      {/* === HUNT === */}
      <Typography sx={sectionLabelSx}>Hunt</Typography>
      <Box sx={fieldGridSx}>
        <TextField
          select
          label="Hunt"
          size="small"
          value={config.hunt}
          onChange={(e) => onHuntChange(e.target.value as HuntLevel)}
        >
          <MenuItem value="300">Hunt 300</MenuItem>
          <MenuItem value="400+">Hunt 400+</MenuItem>
        </TextField>

        <TextField
          select
          label="Mob alvo"
          size="small"
          value={currentSelectionKey}
          onChange={(e) => handleMobSelect(e.target.value)}
          sx={{ gridColumn: { md: "span 2" } }}
        >
          {Object.entries(groupedMobs).map(([groupName, groupMobs]) => {
            if (groupMobs.length > 1) {
              const allTypes = [...new Set(groupMobs.flatMap((m) => m.types))];
              return (
                <MenuItem key={groupName} value={groupName}>
                  {groupName} ({allTypes.join("/")}){mobMarker(groupMobs)}
                </MenuItem>
              );
            }
            return (
              <MenuItem key={groupName} value={groupName}>
                {mobDisplay(groupMobs[0])}
              </MenuItem>
            );
          })}
          <MenuItem value="__custom__">— Custom —</MenuItem>
        </TextField>

        <TextField
          label="Maior HP do grupo"
          size="small"
          value={maxHpInGroup > 0 ? `${maxHpInGroup.toLocaleString()}${maxHpMob ? ` (${maxHpMob.name})` : ""}` : "—"}
          disabled
          slotProps={{ input: { readOnly: true } }}
        />

        <Tooltip title="Multiplicador < 1 que reduz o dano causado ao mob. Valores típicos: 0.55–0.60 (nightmare tank), 0.80–0.90 (mobs comuns). '—' = sem calibração — engine usa média do hunt tier.">
          <TextField
            label="Defesa do mob"
            size="small"
            value={maxHpMob?.defFactor !== undefined ? String(maxHpMob.defFactor) : "—"}
            disabled
            slotProps={{ input: { readOnly: true } }}
          />
        </Tooltip>
      </Box>

      {/* Lista simples dos mobs do mesmo grupo/hunt. Angry vem como entry própria no JSON. */}
      {selectedGroupMobs.length > 0 && (
        <Box
          sx={{
            mt: 2,
            p: 1.5,
            bgcolor: "background.default",
            borderRadius: 1,
            border: 1,
            borderColor: "divider",
            fontSize: "0.78rem",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {selectedGroupMobs.map((m) => {
            const r = resolvedById.get(m.id);
            return (
              <Box key={m.id} sx={{ display: "flex", gap: 1, py: 0.25, alignItems: "center" }}>
                <Box component="span" sx={{ minWidth: 180, fontWeight: 600, display: "flex", alignItems: "center", gap: 0.5 }}>
                  {m.name}
                  {m.tag === "angry" && (
                    <Chip
                      label="ANGRY"
                      size="small"
                      sx={{
                        height: 14,
                        fontSize: "0.6rem",
                        fontWeight: 700,
                        letterSpacing: "0.05em",
                        bgcolor: "error.main",
                        color: "error.contrastText",
                        "& .MuiChip-label": { px: 0.6 },
                      }}
                    />
                  )}
                  {m.todo && (
                    <Tooltip title={m.todo} placement="top" arrow>
                      <Typography component="span" sx={{ color: "warning.main", cursor: "help" }}>⚠</Typography>
                    </Tooltip>
                  )}
                </Box>
                <Box component="span" sx={{ minWidth: 110, color: "text.disabled" }}>
                  {m.types.join("/")}
                </Box>
                <Box component="span" sx={{ minWidth: 95, textAlign: "right" }}>
                  {r?.hp ? r.hp.toLocaleString() : "—"}
                  {r && r.hpSource !== "measured" && (
                    <Tooltip title={SOURCE_LABEL[r.hpSource]} placement="top" arrow>
                      <Typography component="span" sx={{ ml: 0.5, fontSize: "0.7rem", cursor: "help" }}>{SOURCE_ICON[r.hpSource]}</Typography>
                    </Tooltip>
                  )}
                </Box>
                <Box component="span" sx={{ minWidth: 70, textAlign: "right", color: "text.disabled" }}>
                  def {r?.defFactor !== undefined ? r.defFactor.toFixed(3) : "—"}
                  {r && r.defSource !== "measured" && (
                    <Tooltip title={SOURCE_LABEL[r.defSource]} placement="top" arrow>
                      <Typography component="span" sx={{ ml: 0.5, fontSize: "0.7rem", cursor: "help" }}>{SOURCE_ICON[r.defSource]}</Typography>
                    </Tooltip>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Info bar do mob selecionado */}
      <Box
        sx={{
          mt: 2,
          p: 1.5,
          bgcolor: "background.default",
          borderRadius: 1,
          border: 1,
          borderColor: "divider",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 2,
        }}
      >
        <Typography variant="caption">
          Tipos: <strong>{type1}</strong>{config.mob.types[1] ? ` / ${type2}` : ""}
        </Typography>

        {selectedGroupMobs[0]?.effectiveElements && selectedGroupMobs[0].effectiveElements.length > 0 && (
          <Typography variant="caption">
            Dano efetivo: <strong>{selectedGroupMobs[0].effectiveElements.join(", ")}</strong>
          </Typography>
        )}

        {selectedGroupMobs[0]?.effectivenessNotes && (
          <Typography variant="caption" sx={{ fontStyle: "italic", opacity: 0.85 }}>
            {selectedGroupMobs[0].effectivenessNotes}
          </Typography>
        )}

        {currentMobSource && currentMobSource !== "measured" && (
          <Tooltip title={SOURCE_LABEL[currentMobSource]} placement="top" arrow>
            <Typography variant="caption" sx={{ cursor: "help" }}>
              {SOURCE_ICON[currentMobSource]} {SOURCE_LABEL[currentMobSource]}
            </Typography>
          </Tooltip>
        )}

        <Box sx={{ flexGrow: 1 }} />

        {selectedGroupMobs[0]?.wiki && (
          <Link
            href={selectedGroupMobs[0].wiki}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ display: "flex", alignItems: "center", gap: 0.5, fontSize: "0.78rem" }}
          >
            wiki <OpenInNewIcon sx={{ fontSize: 14 }} />
          </Link>
        )}

        <Tooltip title={sourceLegend} placement="left">
          <IconButton size="small">
            <HelpOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Divider sx={{ my: 3 }} />

      {/* === Consumíveis === */}
      <Typography sx={sectionLabelSx}>Consumíveis</Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 3, alignItems: "center" }}>
        <Tooltip title="Permite uso de Swordsman Elixir nas lures. Desligado = só offtank e T1H-do-clã podem starter.">
          <FormControlLabel
            control={
              <Switch
                checked={config.useElixirAtk ?? true}
                onChange={(e) => onUseElixirAtkChange(e.target.checked)}
              />
            }
            label="Usar Swordsman Elixir"
          />
        </Tooltip>

        <Tooltip title="Revive reseta CDs de 1 poke na lure, permitindo castar o kit 2x. CD independente do disk.">
          <TextField
            select
            label="Revive"
            size="small"
            value={config.revive ?? "none"}
            onChange={(e) => onReviveChange(e.target.value as "none" | "normal" | "superior")}
            sx={{ minWidth: 280 }}
          >
            <MenuItem value="none">Nenhum</MenuItem>
            <MenuItem value="normal">Nightmare Revive ($10k, 5min)</MenuItem>
            <MenuItem value="superior">Superior Nightmare Revive ($50k, 4min)</MenuItem>
          </TextField>
        </Tooltip>
      </Box>
    </Paper>
  );
}
