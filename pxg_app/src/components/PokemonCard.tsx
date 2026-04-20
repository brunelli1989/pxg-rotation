import type { Pokemon } from "../types";

interface Props {
  pokemon: Pokemon;
  selected: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
}

const TIER_COLORS: Record<string, string> = {
  T1H: "#ffd700",
  T2: "#c0c0c0",
  T3: "#cd7f32",
  TR: "#4a90d9",
  TM: "#9b59b6",
};

function ccLabel(pokemon: Pokemon): string {
  // Mostra qualquer CC (incluindo stun/silence frontal, que ainda vale como second).
  const kinds = new Set(pokemon.skills.filter((s) => s.cc !== null).map((s) => s.cc));
  if (kinds.size === 0) return "No CC";
  return Array.from(kinds).join("/");
}

export function PokemonCard({ pokemon, selected, disabled, onToggle }: Props) {
  const cc = ccLabel(pokemon);
  const hasCC = cc !== "No CC";
  // Uncalibrated = skill de dano (sem buff) com power undefined → usa fallback.
  // pokemon.todo é só metadado informativo e não indica falta de calibração.
  const uncalibrated = pokemon.skills.some(
    (s) => s.power === undefined && s.buff === null
  );

  return (
    <div
      className={`pokemon-card ${selected ? "selected" : ""} ${disabled ? "disabled" : ""}`}
      onClick={() => !disabled && onToggle(pokemon.id)}
    >
      <div className="card-header">
        <span className="pokemon-name">{pokemon.name}</span>
        {uncalibrated && (
          <span
            className="calibration-warning"
            title={`Dano aproximado — este pokémon ainda não foi testado no dummy. Estou usando a média dos pokémons calibrados de mesmo tier/função (${pokemon.tier}, ${pokemon.role ?? "?"}).`}
          >
            ⚠️
          </span>
        )}
        <span
          className="tier-badge"
          style={{ backgroundColor: TIER_COLORS[pokemon.tier] ?? "#888" }}
        >
          {pokemon.tier}
        </span>
      </div>

      <div className="card-meta">
        <span className={`cc-indicator ${hasCC ? "has-cc" : "no-cc"}`}>{cc}</span>
      </div>
    </div>
  );
}
