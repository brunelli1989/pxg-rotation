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
import { DiskSelector } from "./DiskSelector";

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

const inputCls = "bg-bg-skills text-text border border-[#444] px-2.5 py-1.5 rounded-md text-[0.875rem] min-w-[120px]";
const labelCls = "flex flex-col gap-1 text-[0.8rem] text-text-muted";
const hintCls = "text-[0.75rem] text-text-dim";
const fieldsetCls = "border border-[#2a3e5e] rounded-md px-3 pt-2.5 pb-1 mb-3";
const legendCls = "px-1.5 text-[0.75rem] text-[#6fa3d4] font-semibold uppercase tracking-wider";
const rowCls = "flex flex-wrap gap-4 mb-3";

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

  const currentResolved = resolvedByName.get(config.mob.name);
  const currentMobSource = currentResolved
    ? worstSource(currentResolved.hpSource, currentResolved.defSource)
    : null;

  return (
    <section className="bg-bg-card border border-[#333] rounded-lg p-4 mt-6 shadow-[var(--shadow-card)]">
      <h2 className="m-0 mb-4 text-lg font-semibold text-text">Configuração de Dano</h2>

      <fieldset className={fieldsetCls}>
        <legend className={legendCls}>Player</legend>
        <div className={rowCls}>
          <label className={labelCls} title="Nível BASE do char (ignorar o (+X) do Nightmare Level Bonus — NL não afeta dano, só HP/def). Validado empiricamente com char Orebound 369(+48) vs Volcanic 600(+0).">
            Player lvl (base):
            <input
              type="number"
              min={1}
              max={600}
              value={config.playerLvl}
              onChange={(e) => onPlayerLvlChange(Number(e.target.value))}
              className={inputCls}
            />
          </label>

          <label className={labelCls}>
            Clã:
            <select
              value={config.clan ?? ""}
              onChange={(e) => onClanChange((e.target.value || null) as ClanName | null)}
              className={inputCls}
            >
              <option value="">Nenhum</option>
              {clansData.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.displayName} ({c.bonuses.map((b) => `+${Math.round(b.atk * 100)}% ${b.element}`).join(", ")})
                </option>
              ))}
            </select>
          </label>

          <label className={labelCls}>
            Held do device:
            <select
              value={config.device.kind}
              onChange={(e) => onDeviceChange({ kind: e.target.value as DeviceHeldKind })}
              className={inputCls}
            >
              <option value="none">Nenhum</option>
              <option value="x-attack">X-Attack</option>
              <option value="x-boost">X-Boost</option>
              <option value="x-critical">X-Critical</option>
              <option value="x-defense">X-Defense</option>
            </select>
          </label>

          <label className={labelCls}>
            Tier do device:
            <select
              value={config.device.tier}
              disabled={config.device.kind === "none"}
              onChange={(e) => onDeviceChange({ tier: Number(e.target.value) as XAtkTier })}
              className={inputCls}
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

          <DiskSelector diskLevel={diskLevel} onChange={onDiskLevelChange} />
        </div>
      </fieldset>

      <fieldset className={fieldsetCls}>
        <legend className={legendCls}>Hunt</legend>
        <div className={rowCls}>
          <label className={labelCls}>
            Hunt:
            <select
              value={config.hunt}
              onChange={(e) => onHuntChange(e.target.value as HuntLevel)}
              className={inputCls}
            >
              <option value="300">Hunt 300</option>
              <option value="400+">Hunt 400+</option>
            </select>
          </label>

          <label className={labelCls}>
            Mob alvo:
            <select
              value={currentSelectionKey}
              onChange={(e) => handleMobSelect(e.target.value)}
              className={inputCls}
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

          <label className={labelCls}>
            <span>Maior HP do grupo / Defesa:</span>
            <span className="flex gap-1.5">
              <input
                type="text"
                value={
                  maxHpInGroup > 0
                    ? `${maxHpInGroup.toLocaleString()}${maxHpMob ? ` (${maxHpMob.name})` : ""}`
                    : "—"
                }
                disabled
                readOnly
                className={inputCls}
              />
              <input
                type="text"
                className={`${inputCls} min-w-[60px] max-w-[80px]`}
                value={maxHpMob?.defFactor !== undefined ? String(maxHpMob.defFactor) : "—"}
                disabled
                readOnly
              />
            </span>
          </label>
        </div>

        <div className={rowCls}>
          <span className={hintCls}>
            Tipo 1: <strong>{type1}</strong> | Tipo 2: <strong>{type2}</strong>
            {selectedGroupMobs[0]?.wiki && (
              <a
                href={selectedGroupMobs[0].wiki}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2.5 text-[#6fa3d4] no-underline font-semibold hover:text-[#8cb8e0] hover:underline"
              >
                ↗ wiki
              </a>
            )}
            {currentMobSource && currentMobSource !== "measured" && (
              <span className="ml-1.5 text-[0.8rem] cursor-help opacity-85 hover:opacity-100" title={SOURCE_LABEL[currentMobSource]}>
                {SOURCE_ICON[currentMobSource]} {SOURCE_LABEL[currentMobSource]}
              </span>
            )}
          </span>
          {selectedGroupMobs[0]?.effectiveElements && selectedGroupMobs[0].effectiveElements.length > 0 && (
            <span className={hintCls}>
              Dano efetivo vs mob: <strong>{selectedGroupMobs[0].effectiveElements.join(", ")}</strong>
            </span>
          )}
          {selectedGroupMobs[0]?.effectivenessNotes && (
            <span className={`${hintCls} italic opacity-85`}>
              {selectedGroupMobs[0].effectivenessNotes}
            </span>
          )}
          <span className={hintCls}>
            {Object.entries(SOURCE_ICON).map(([src, icon]) => (
              <span key={src} className="mr-2.5">
                {icon} {SOURCE_LABEL[src as MobFieldSource]}
              </span>
            ))}
          </span>
          <span className={hintCls}>
            <strong>Defesa</strong>: multiplicador &lt; 1 que reduz o dano causado ao mob.
            Valores típicos: 0.55–0.60 (nightmare tank), 0.80–0.90 (mobs comuns).
            "—" = sem calibração — engine usa média do hunt tier.
          </span>
        </div>

        <div className={rowCls}>
          <label className="flex flex-row items-center gap-2 self-end pb-1.5 text-[0.8rem] text-text-muted" title="Permite uso de Swordsman Elixir nas lures. Desligado = só offtank e T1H-do-clã podem starter.">
            <input
              type="checkbox"
              checked={config.useElixirAtk ?? true}
              onChange={(e) => onUseElixirAtkChange(e.target.checked)}
            />
            Usar Swordsman Elixir
          </label>

          <label className={labelCls} title="Revive reseta CDs de 1 poke na lure, permitindo castar o kit 2x. CD independente do disk.">
            Revive:
            <select
              value={config.revive ?? "none"}
              onChange={(e) => onReviveChange(e.target.value as "none" | "normal" | "superior")}
              className={inputCls}
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
