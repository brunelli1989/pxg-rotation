import { useEffect, useMemo, useState } from "react";
import type { DamageConfig, HeldKind, HeldItem, Pokemon, PokeSetup, Tier, XAtkTier } from "../types";
import { estimatePokeSoloDamage } from "../engine/damage";
import { getOptimalSkillOrder } from "../engine/scoring";
import { DEFAULT_POKE_SETUP } from "../hooks/useDamageConfig";

const X_ATK_TIERS_ALL: XAtkTier[] = [0, 1, 2, 3, 4, 5, 6, 7, 8];

const MAX_BOOST = 80;
function minBoostForTier(tier: Tier): number {
  if (tier === "TR") return 70;
  if (tier === "TM") return 80;
  return 0;
}
function clampBoost(tier: Tier, v: number): number {
  return Math.min(Math.max(v, minBoostForTier(tier)), MAX_BOOST);
}

// Ordem canônica dos tiers do jogo (usada pra sort)
const TIER_ORDER: Record<Tier, number> = { T1H: 0, T1C: 1, T2: 2, T3: 3, TM: 4, TR: 5 };

type SortCol = "name" | "boost" | "heldKind" | "heldTier" | "noDevice" | "withDevice" | "noDeviceElixir" | "withDeviceElixir";
type SortDir = "asc" | "desc";

interface Props {
  pokes: Pokemon[];
  config: DamageConfig;
  onChange: (pokeId: string, setup: Partial<PokeSetup>) => void;
}

interface DamageRow {
  noDevice: number;
  withDevice: number;
  noDeviceElixir: number;
  withDeviceElixir: number;
}

export function PokeSetupEditor({ pokes, config, onChange }: Props) {
  // Keyed by poke.id; populated when user clicks "Estimar dano"
  const [estimates, setEstimates] = useState<Record<string, DamageRow>>({});
  const [sort, setSort] = useState<{ col: SortCol; dir: SortDir }>({ col: "name", dir: "asc" });

  const toggleSort = (col: SortCol) => {
    setSort((s) => (s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" }));
  };

  const sortedPokes = useMemo(() => {
    const getValue = (p: Pokemon): string | number => {
      const setup = config.pokeSetups[p.id] ?? DEFAULT_POKE_SETUP;
      const est = estimates[p.id];
      switch (sort.col) {
        case "name": return p.name.toLowerCase();
        case "boost": return clampBoost(p.tier, setup.boost);
        case "heldKind": return setup.held.kind;
        case "heldTier": return setup.held.tier * 10 + TIER_ORDER[p.tier]; // inclui poke tier como desempate
        case "noDevice": return est?.noDevice ?? -1;
        case "withDevice": return est?.withDevice ?? -1;
        case "noDeviceElixir": return est?.noDeviceElixir ?? -1;
        case "withDeviceElixir": return est?.withDeviceElixir ?? -1;
      }
    };
    const sorted = [...pokes].sort((a, b) => {
      const av = getValue(a), bv = getValue(b);
      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [pokes, config.pokeSetups, estimates, sort]);

  const sortArrow = (col: SortCol) => (sort.col === col ? (sort.dir === "asc" ? " ▲" : " ▼") : "");

  // Normaliza boost pra respeitar min do tier (TR +70, TM +80). Roda sempre que
  // muda a lista de pokes ou os setups persistidos.
  useEffect(() => {
    for (const p of pokes) {
      const stored = config.pokeSetups[p.id];
      if (stored && stored.boost !== clampBoost(p.tier, stored.boost)) {
        onChange(p.id, { boost: clampBoost(p.tier, stored.boost) });
      }
    }
  }, [pokes, config.pokeSetups, onChange]);

  if (pokes.length === 0) return null;

  const handleEstimate = () => {
    // Garante que todos os pokes tenham setup (usa default pros que não têm)
    const configWithDefaults: DamageConfig = {
      ...config,
      pokeSetups: { ...config.pokeSetups },
    };
    for (const p of pokes) {
      if (!configWithDefaults.pokeSetups[p.id]) {
        configWithDefaults.pokeSetups[p.id] = DEFAULT_POKE_SETUP;
      }
    }

    const next: Record<string, DamageRow> = {};
    for (const p of pokes) {
      const ordered = getOptimalSkillOrder(p);
      next[p.id] = {
        noDevice: estimatePokeSoloDamage(p, ordered, configWithDefaults, false, false),
        withDevice: estimatePokeSoloDamage(p, ordered, configWithDefaults, true, false),
        noDeviceElixir: estimatePokeSoloDamage(p, ordered, configWithDefaults, false, true),
        withDeviceElixir: estimatePokeSoloDamage(p, ordered, configWithDefaults, true, true),
      };
    }
    setEstimates(next);
  };

  return (
    <section className="poke-setup">
      <h2>Setup dos Pokémons</h2>
      <p className="hint">
        X-Held: X-Attack (T1-T8) ou X-Boost (T1-T7). Só 1 held por poke.
      </p>
      <table className="poke-setup-table">
        <thead>
          <tr>
            <th onClick={() => toggleSort("name")} style={{ cursor: "pointer" }}>Pokémon{sortArrow("name")}</th>
            <th onClick={() => toggleSort("boost")} style={{ cursor: "pointer" }}>Boost{sortArrow("boost")}</th>
            <th onClick={() => toggleSort("heldKind")} style={{ cursor: "pointer" }}>X-Held{sortArrow("heldKind")}</th>
            <th onClick={() => toggleSort("heldTier")} style={{ cursor: "pointer" }}>Tier{sortArrow("heldTier")}</th>
            <th onClick={() => toggleSort("noDevice")} style={{ cursor: "pointer" }}>Dano sem device{sortArrow("noDevice")}</th>
            <th onClick={() => toggleSort("withDevice")} style={{ cursor: "pointer" }}>Dano com device{sortArrow("withDevice")}</th>
            <th onClick={() => toggleSort("noDeviceElixir")} style={{ cursor: "pointer" }}>Dano + Elixir (sem device){sortArrow("noDeviceElixir")}</th>
            <th onClick={() => toggleSort("withDeviceElixir")} style={{ cursor: "pointer" }}>Dano + Elixir (com device){sortArrow("withDeviceElixir")}</th>
          </tr>
        </thead>
        <tbody>
          {sortedPokes.map((p) => {
            const setup = config.pokeSetups[p.id] ?? {
              ...DEFAULT_POKE_SETUP,
              boost: clampBoost(p.tier, DEFAULT_POKE_SETUP.boost),
            };
            const heldKind = setup.held.kind;
            const maxTier: XAtkTier = heldKind === "x-boost" ? 7 : 8;
            const availableTiers = X_ATK_TIERS_ALL.filter((t) => t <= maxTier);
            const minBoost = minBoostForTier(p.tier);

            const setHeld = (next: Partial<HeldItem>) => {
              onChange(p.id, { held: { ...setup.held, ...next } });
            };

            const est = estimates[p.id];
            const noDeviceCell = est ? Math.round(est.noDevice).toLocaleString() : "—";
            const withDeviceCell = est ? Math.round(est.withDevice).toLocaleString() : "—";
            const noDeviceElixirCell = est ? Math.round(est.noDeviceElixir).toLocaleString() : "—";
            const withDeviceElixirCell = est ? Math.round(est.withDeviceElixir).toLocaleString() : "—";

            return (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>
                  <input
                    type="number"
                    min={minBoost}
                    max={MAX_BOOST}
                    value={clampBoost(p.tier, setup.boost)}
                    onChange={(e) =>
                      onChange(p.id, { boost: clampBoost(p.tier, Number(e.target.value)) })
                    }
                    className="inline-input"
                    title={`${p.tier}: boost ${minBoost}-${MAX_BOOST}`}
                  />
                </td>
                <td>
                  <select
                    value={heldKind}
                    onChange={(e) => {
                      const kind = e.target.value as HeldKind;
                      let tier = setup.held.tier;
                      if (kind === "x-boost" && tier > 7) tier = 7;
                      if (kind === "none") tier = 0;
                      setHeld({ kind, tier: tier as XAtkTier });
                    }}
                  >
                    <option value="none">Nenhum</option>
                    <option value="x-attack">X-Attack</option>
                    <option value="x-boost">X-Boost</option>
                    <option value="x-critical">X-Critical</option>
                    <option value="x-defense">X-Defense</option>
                  </select>
                </td>
                <td>
                  <select
                    value={setup.held.tier}
                    disabled={heldKind === "none"}
                    onChange={(e) => setHeld({ tier: Number(e.target.value) as XAtkTier })}
                  >
                    {availableTiers.map((t) => (
                      <option key={t} value={t}>
                        {t === 0 ? "—" : `T${t}`}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{noDeviceCell}</td>
                <td>{withDeviceCell}</td>
                <td>{noDeviceElixirCell}</td>
                <td>{withDeviceElixirCell}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ marginTop: "12px" }}>
        <button className="small-btn" onClick={handleEstimate}>
          Estimar dano
        </button>
      </div>
    </section>
  );
}
