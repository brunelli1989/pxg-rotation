import { useState, useCallback, useEffect } from "react";
import type { DiskLevel, Pokemon, RosterPokemon, RotationResult } from "./types";
import pokemonData from "./data/pokemon.json";
import rosterData from "./data/pokemon_roster.json";
import { PokemonSelector } from "./components/PokemonSelector";
import { DiskSelector } from "./components/DiskSelector";
import { RotationResultView } from "./components/RotationResult";
import { SkillTimeline } from "./components/SkillTimeline";
import { DamageConfigPanel } from "./components/DamageConfigPanel";
import { PokeSetupEditor } from "./components/PokeSetupEditor";
import { LureDamagePreview } from "./components/LureDamagePreview";
import { useRotation } from "./hooks/useRotation";
import { useDamageConfig } from "./hooks/useDamageConfig";
import "./App.css";

const pokemonWithSkillsRaw = pokemonData as Pokemon[];
const roster = rosterData as RosterPokemon[];

// Map id → elements (do roster). Usado pra enriquecer os pokes com tipo defensivo.
const elementsById: Record<string, RosterPokemon["elements"]> = Object.fromEntries(
  roster.map((r) => [r.id, r.elements])
);

// Merge: pokemon.json (com skills) tem prioridade; resto vem do roster com skills vazias.
// Em ambos enriquecemos com `elements` do roster pra starter resist factor funcionar.
const pokemonWithSkills: Pokemon[] = pokemonWithSkillsRaw.map((p) => ({
  ...p,
  elements: elementsById[p.id] ?? p.elements,
}));
const existingIds = new Set(pokemonWithSkills.map((p) => p.id));
const rosterOnly: Pokemon[] = roster
  .filter((r) => !existingIds.has(r.id))
  .map((r) => ({
    id: r.id,
    name: r.name,
    tier: r.tier,
    skills: [],
    elements: r.elements,
  }));

const allPokemon: Pokemon[] = [...pokemonWithSkills, ...rosterOnly].sort((a, b) =>
  a.name.localeCompare(b.name)
);

// Map id → elements (legado; manter enquanto UI usa)
const pokeElements: Record<string, string[]> = elementsById;

const DISK_STORAGE_KEY = "pxg_disk_level";
const SELECTED_STORAGE_KEY = "pxg_selected_ids";

function loadDiskLevel(): DiskLevel {
  const raw = localStorage.getItem(DISK_STORAGE_KEY);
  if (raw === null) return 4;
  const n = Number(raw);
  if (n === 0 || n === 1 || n === 2 || n === 3 || n === 4) return n;
  return 4;
}

function loadSelectedIds(): string[] {
  const raw = localStorage.getItem(SELECTED_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      // Filter out IDs that no longer exist in the data
      const validIds = new Set(allPokemon.map((p) => p.id));
      return parsed.filter((id) => validIds.has(id));
    }
  } catch {
    /* ignore */
  }
  return [];
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m${s.toString().padStart(2, "0")}s` : `${s}s`;
}

function buildReport(
  selectedIds: string[],
  diskLevel: DiskLevel,
  result: RotationResult | null,
  damageConfig?: import("./types").DamageConfig
): string {
  const lines: string[] = [];
  lines.push(`=== PxG Rotation Generator — Dados ===`);
  lines.push(`Disk: ${diskLevel === 0 ? "Nenhum" : `Disk ${diskLevel}.0`}`);
  if (damageConfig) {
    lines.push(`Player: lvl ${damageConfig.playerLvl} | clã ${damageConfig.clan ?? "Nenhum"} | hunt ${damageConfig.hunt}`);
    const m = damageConfig.mob;
    const bestStr = m.bestStarterElements?.length ? ` | best starter: ${m.bestStarterElements.join(", ")}` : "";
    lines.push(`Mob: ${m.name} (${m.types.join("/")}) HP=${m.hp} def=${m.defFactor ?? "—"}${bestStr}`);
    const dev = damageConfig.device;
    lines.push(`Device held: ${dev.kind === "none" ? "—" : `${dev.kind} T${dev.tier}`}`);
    if (damageConfig.hunt === "400+") {
      const filter = damageConfig.starterRoleFilter ?? "both";
      const filterLabel: Record<string, string> = {
        both: "Offtank + T1H",
        offtank: "Só Offtank",
        t1h: "Só T1H",
        "t1h-clan": "T1H do clã",
      };
      lines.push(`Estilo starter: ${filterLabel[filter] ?? filter}`);
    }
  }
  lines.push(`Pokémons selecionados (${selectedIds.length}):`);
  selectedIds.forEach((id) => {
    const p = allPokemon.find((x) => x.id === id);
    if (p) lines.push(`  - ${p.name} (${p.tier})`);
  });
  lines.push("");

  if (!result) {
    lines.push("(Nenhuma rotação gerada ainda)");
    return lines.join("\n");
  }

  const boxesPerHour = Math.round((3600 * result.steps.length) / result.totalTime);
  const pokesPerHour = boxesPerHour * 6;

  lines.push(`=== Resultado ===`);
  lines.push(`Ciclo: ${formatTime(result.totalTime)} | Ocioso: ${formatTime(result.totalIdle)} | Lures: ${result.steps.length}`);
  lines.push(`Boxes/h: ${boxesPerHour} | Pokémons/h: ${pokesPerHour}`);

  const devicePoke = result.devicePokemonId
    ? allPokemon.find((p) => p.id === result.devicePokemonId)?.name
    : null;
  lines.push(`Device: ${devicePoke ?? "Nenhum"}`);
  lines.push("");

  lines.push(`=== Rotação (${result.steps.length} lures) ===`);
  result.steps.forEach((step, i) => {
    const lure = step.lure;
    const activeTime = step.timeEnd - step.timeStart - step.idleBefore;
    const typeLabel =
      lure.type === "group"
        ? `Group (${2 + lure.extraMembers.length})`
        : lure.type === "dupla"
          ? "Dupla"
          : "Solo";
    const finisher = lure.usesDevice
      ? "Device"
      : lure.usesElixirAtk
        ? lure.type === "solo_elixir"
          ? "Elixir Atk"
          : `${typeLabel} + Elixir Atk`
        : typeLabel;
    const defense: string[] = [];
    if (lure.starterUsesHarden) defense.push("Harden");
    if (lure.starterUsesElixirDef) defense.push("Elixir Def");
    const defStr = defense.length ? ` | Defesa: ${defense.join("+")}` : "";

    const names = [lure.starter.name, lure.second?.name, ...lure.extraMembers.map((m) => m.poke.name)].filter(
      Boolean
    );
    const pokes = names.join(" + ");

    lines.push(`${i + 1}. ${pokes} [${finisher}]${defStr}`);
    lines.push(`   Duração: ${formatTime(activeTime)}${step.idleBefore > 0 ? ` | Espera: ${formatTime(step.idleBefore)}` : ""}`);
  });

  return lines.join("\n");
}

function App() {
  const [selectedIds, setSelectedIds] = useState<string[]>(() => loadSelectedIds());
  const [diskLevel, setDiskLevel] = useState<DiskLevel>(() => loadDiskLevel());
  const [showResult, setShowResult] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const damage = useDamageConfig();

  useEffect(() => {
    localStorage.setItem(DISK_STORAGE_KEY, String(diskLevel));
  }, [diskLevel]);

  useEffect(() => {
    localStorage.setItem(SELECTED_STORAGE_KEY, JSON.stringify(selectedIds));
  }, [selectedIds]);

  const { result, loading, progress, cancel } = useRotation(allPokemon, selectedIds, diskLevel, showResult, damage.config);
  const pool = allPokemon.filter((p) => selectedIds.includes(p.id));

  const handleToggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return [...prev, id];
    });
    setShowResult(false);
  }, []);

  const handleGenerate = () => {
    if (pool.length > 0) setShowResult(true);
  };

  const handleCopy = async () => {
    const report = buildReport(selectedIds, diskLevel, result, damage.config);
    try {
      await navigator.clipboard.writeText(report);
      setCopyFeedback("Copiado!");
    } catch {
      setCopyFeedback("Falha ao copiar");
    }
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  const devicePokeName = result?.devicePokemonId
    ? allPokemon.find((p) => p.id === result.devicePokemonId)?.name
    : null;

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="app">
      <header className="app-header">
        <h1>PxG Rotation Generator</h1>
        <DiskSelector diskLevel={diskLevel} onChange={setDiskLevel} />
      </header>

      <main>
        <PokemonSelector
          allPokemon={allPokemon}
          selectedIds={selectedIds}
          onToggle={handleToggle}
          elementsByPokeId={pokeElements}
        />

        <DamageConfigPanel
          config={damage.config}
          onPlayerLvlChange={damage.setPlayerLvl}
          onClanChange={damage.setClan}
          onHuntChange={damage.setHunt}
          onMobChange={damage.setMob}
          onDeviceChange={damage.setDevice}
          onStarterRoleFilterChange={damage.setStarterRoleFilter}
        />

        <PokeSetupEditor
          pokes={pool}
          config={damage.config}
          onChange={damage.setPokeSetup}
        />

        <div className="generate-section">
          <button
            className="generate-btn"
            onClick={handleGenerate}
            disabled={pool.length === 0 || loading}
          >
            {loading ? "Calculando..." : `Gerar Rotação (${pool.length} pokémon selecionados)`}
          </button>
          {pool.length > 6 && !loading && (
            <p className="pool-hint">
              Mais de 6 selecionados — o gerador vai encontrar a melhor composição de 6
            </p>
          )}
        </div>

        {loading && (
          <div className="loading-card">
            <div className="spinner" />
            <div className="loading-text">
              <div className="loading-title">Calculando melhor rotação...</div>
              {progress.total > 0 && (
                <>
                  <div className="progress-bar-wrapper">
                    <div className="progress-bar" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="progress-text">
                    {progress.done.toLocaleString()} / {progress.total.toLocaleString()} composições ({pct}%)
                  </div>
                </>
              )}
              {progress.total === 0 && (
                <div className="progress-text">Preparando workers...</div>
              )}
            </div>
            <button
              className="cancel-btn"
              onClick={() => {
                cancel();
                setShowResult(false);
              }}
            >
              Cancelar
            </button>
          </div>
        )}

        {!loading && result && (
          <>
            <div className="result-info">
              {pool.length > 6 && (
                <div className="chosen-bag">
                  <h3>Melhor composição de 6:</h3>
                  <div className="chosen-names">
                    {result.selectedIds.map((id) => {
                      const poke = allPokemon.find((p) => p.id === id);
                      return (
                        <span key={id} className="chosen-name">
                          {poke?.name ?? id}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="device-info">
                <span className="device-label">Device:</span>
                {devicePokeName ? (
                  <span className="device-pokemon">{devicePokeName}</span>
                ) : (
                  <span className="device-none">Nenhum (todos usam elixir)</span>
                )}
              </div>
              <div className="copy-section">
                <button className="copy-btn" onClick={handleCopy}>
                  📋 Copiar dados
                </button>
                {copyFeedback && <span className="copy-feedback">{copyFeedback}</span>}
              </div>
            </div>
            <RotationResultView result={result} />
            <SkillTimeline result={result} />
            <LureDamagePreview result={result} config={damage.config} />
          </>
        )}
      </main>
    </div>
  );
}

export default App;
