import type {
  ClanName,
  DamageConfig,
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

const mobs = mobsData as MobEntry[];
const resolvedByName = new Map<string, ResolvedMob>(
  mobs.map((m) => [m.name, resolveMobConfig(m, mobs)])
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

function worstSource(a: MobFieldSource, b: MobFieldSource): MobFieldSource {
  return SOURCE_RANK[a] >= SOURCE_RANK[b] ? a : b;
}

function entrySource(m: MobEntry): MobFieldSource {
  const r = resolvedByName.get(m.name);
  return r ? worstSource(r.hpSource, r.defSource) : "default";
}

function mobMarker(entries: MobEntry[]): string {
  const worst = entries.map(entrySource).reduce(worstSource);
  return " " + SOURCE_ICON[worst];
}

interface Props {
  config: DamageConfig;
  onPlayerLvlChange: (v: number) => void;
  onClanChange: (v: ClanName | null) => void;
  onHuntChange: (v: HuntLevel) => void;
  onMobChange: (mob: Partial<MobConfig>) => void;
  onDeviceChange: (device: Partial<DeviceHeld>) => void;
  onUseElixirAtkChange: (v: boolean) => void;
  onReviveChange: (v: "none" | "normal" | "superior") => void;
}

export function DamageConfigPanel({
  config,
  onPlayerLvlChange,
  onClanChange,
  onHuntChange,
  onMobChange,
  onDeviceChange,
  onUseElixirAtkChange,
  onReviveChange,
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

    // Maior effective HP = HP / defFactor (mais tanky)
    const hardest = groupMobs
      .map((m) => resolvedByName.get(m.name)!)
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

  // Match current mob.name against groupName (multi) or individual name (solo)
  const currentGroup = Object.entries(groupedMobs).find(([groupName, groupMobs]) => {
    if (groupMobs.length > 1) return groupName === config.mob.name;
    return groupMobs[0].name === config.mob.name;
  });
  const currentSelectionKey = currentGroup ? currentGroup[0] : "__custom__";

  const type1 = config.mob.types[0] ?? "—";
  const type2 = config.mob.types[1] ?? "—";

  // Maior HP dentro do grupo atualmente selecionado
  const selectedGroupMobs = currentGroup ? currentGroup[1] : [];
  const maxHpInGroup = selectedGroupMobs.reduce((max, m) => Math.max(max, m.hp ?? 0), 0);
  const maxHpMob = selectedGroupMobs.find((m) => m.hp === maxHpInGroup);

  const mobDisplay = (m: MobEntry) =>
    `${m.name} (${m.types.join("/")})${mobMarker([m])}`;

  const currentResolved = resolvedByName.get(config.mob.name);
  const currentMobSource = currentResolved
    ? worstSource(currentResolved.hpSource, currentResolved.defSource)
    : null;

  return (
    <section className="damage-config">
      <h2>Configuração de Dano</h2>

      <fieldset className="damage-config-group">
        <legend>Player</legend>
        <div className="damage-config-row">
          <label title="Nível BASE do char (ignorar o (+X) do Nightmare Level Bonus — NL não afeta dano, só HP/def). Validado empiricamente com char Orebound 369(+48) vs Volcanic 600(+0).">
            Player lvl (base):
            <input
              type="number"
              min={1}
              max={600}
              value={config.playerLvl}
              onChange={(e) => onPlayerLvlChange(Number(e.target.value))}
            />
          </label>

          <label>
            Clã:
            <select
              value={config.clan ?? ""}
              onChange={(e) => onClanChange((e.target.value || null) as ClanName | null)}
            >
              <option value="">Nenhum</option>
              {clansData.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.displayName} ({c.bonuses.map((b) => `+${Math.round(b.atk * 100)}% ${b.element}`).join(", ")})
                </option>
              ))}
            </select>
          </label>

          <label>
            Held do device:
            <select
              value={config.device.kind}
              onChange={(e) => onDeviceChange({ kind: e.target.value as DeviceHeldKind })}
            >
              <option value="none">Nenhum</option>
              <option value="x-attack">X-Attack</option>
              <option value="x-boost">X-Boost</option>
              <option value="x-critical">X-Critical</option>
              <option value="x-defense">X-Defense</option>
            </select>
          </label>

          <label>
            Tier do device:
            <select
              value={config.device.tier}
              disabled={config.device.kind === "none"}
              onChange={(e) => onDeviceChange({ tier: Number(e.target.value) as XAtkTier })}
            >
              {TIERS.filter((t) =>
                config.device.kind === "x-boost" ? t <= 7 : true
              ).map((t) => (
                <option key={t} value={t}>
                  {t === 0 ? "—" : `T${t}`}
                </option>
              ))}
            </select>
          </label>
        </div>

      </fieldset>

      <fieldset className="damage-config-group">
        <legend>Hunt</legend>
        <div className="damage-config-row">
          <label>
            Hunt:
            <select
              value={config.hunt}
              onChange={(e) => onHuntChange(e.target.value as HuntLevel)}
            >
              <option value="300">Hunt 300</option>
              <option value="400+">Hunt 400+</option>
            </select>
          </label>

          <label>
            Mob alvo:
            <select
              value={currentSelectionKey}
              onChange={(e) => handleMobSelect(e.target.value)}
            >
              {Object.entries(groupedMobs).map(([groupName, groupMobs]) => {
                if (groupMobs.length > 1) {
                  const allTypes = [...new Set(groupMobs.flatMap((m) => m.types))];
                  return (
                    <option key={groupName} value={groupName}>
                      {groupName} ({allTypes.join("/")}){mobMarker(groupMobs)}
                    </option>
                  );
                }
                return (
                  <option key={groupName} value={groupName}>
                    {mobDisplay(groupMobs[0])}
                  </option>
                );
              })}
              <option value="__custom__">— Custom —</option>
            </select>
          </label>

          <label className="hp-def-group">
            <span>Maior HP do grupo / Defesa:</span>
            <span className="hp-def-inputs">
              <input
                type="text"
                value={
                  maxHpInGroup > 0
                    ? `${maxHpInGroup.toLocaleString()}${maxHpMob ? ` (${maxHpMob.name})` : ""}`
                    : "—"
                }
                disabled
                readOnly
              />
              <input
                type="text"
                className="def-input"
                value={maxHpMob?.defFactor !== undefined ? String(maxHpMob.defFactor) : "—"}
                disabled
                readOnly
              />
            </span>
          </label>
        </div>

        <div className="damage-config-row">
          <span className="hint">
            Tipo 1: <strong>{type1}</strong> | Tipo 2: <strong>{type2}</strong>
            {selectedGroupMobs[0]?.wiki && (
              <a
                href={selectedGroupMobs[0].wiki}
                target="_blank"
                rel="noopener noreferrer"
                style={{ marginLeft: 10 }}
              >
                ↗ wiki
              </a>
            )}
            {currentMobSource && currentMobSource !== "measured" && (
              <span className="calibration-warning" title={SOURCE_LABEL[currentMobSource]}>
                {SOURCE_ICON[currentMobSource]} {SOURCE_LABEL[currentMobSource]}
              </span>
            )}
          </span>
          {selectedGroupMobs[0]?.effectiveElements && selectedGroupMobs[0].effectiveElements.length > 0 && (
            <span className="hint">
              Dano efetivo vs mob: <strong>{selectedGroupMobs[0].effectiveElements.join(", ")}</strong>
            </span>
          )}
          {selectedGroupMobs[0]?.effectivenessNotes && (
            <span className="hint" style={{ fontStyle: "italic", opacity: 0.85 }}>
              {selectedGroupMobs[0].effectivenessNotes}
            </span>
          )}
          <span className="hint legend">
            {Object.entries(SOURCE_ICON).map(([src, icon]) => (
              <span key={src} style={{ marginRight: 10 }}>
                {icon} {SOURCE_LABEL[src as MobFieldSource]}
              </span>
            ))}
          </span>
          <span className="hint">
            <strong>Defesa</strong>: multiplicador &lt; 1 que reduz o dano causado ao mob.
            Valores típicos: 0.55–0.60 (nightmare tank), 0.80–0.90 (mobs comuns).
            "—" = sem calibração — engine usa média do hunt tier.
          </span>
        </div>

        <div className="damage-config-row">
          <label className="checkbox-label" title="Permite uso de Swordsman Elixir nas lures. Desligado = só offtank e T1H-do-clã podem starter.">
            <input
              type="checkbox"
              checked={config.useElixirAtk ?? true}
              onChange={(e) => onUseElixirAtkChange(e.target.checked)}
            />
            Usar Swordsman Elixir
          </label>

          <label title="Revive reseta CDs de 1 poke na lure, permitindo castar o kit 2x. CD independente do disk.">
            Revive:
            <select
              value={config.revive ?? "none"}
              onChange={(e) => onReviveChange(e.target.value as "none" | "normal" | "superior")}
            >
              <option value="none">Nenhum</option>
              <option value="normal">Nightmare Revive ($10k, 5min)</option>
              <option value="superior">Superior Nightmare Revive ($50k, 4min)</option>
            </select>
          </label>
        </div>
      </fieldset>
    </section>
  );
}
