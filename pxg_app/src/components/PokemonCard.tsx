import type { Pokemon } from "../types";

interface Props {
  pokemon: Pokemon;
  selected: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
}

const TIER_COLORS: Record<string, string> = {
  T1A: "#ff6b9d",
  T1B: "#ffa07a",
  T1H: "#ffd700",
  T1C: "#e8c872",
  T2: "#c0c0c0",
  T3: "#cd7f32",
  TR: "#4a90d9",
  TM: "#9b59b6",
};

const ELEMENT_COLORS: Record<string, { bg: string; text: string }> = {
  fire: { bg: "#f08030", text: "#fff" },
  water: { bg: "#6890f0", text: "#fff" },
  grass: { bg: "#78c850", text: "#fff" },
  electric: { bg: "#f8d030", text: "#222" },
  ice: { bg: "#98d8d8", text: "#222" },
  fighting: { bg: "#c03028", text: "#fff" },
  poison: { bg: "#a040a0", text: "#fff" },
  ground: { bg: "#e0c068", text: "#222" },
  flying: { bg: "#a890f0", text: "#fff" },
  psychic: { bg: "#f85888", text: "#fff" },
  bug: { bg: "#a8b820", text: "#fff" },
  rock: { bg: "#b8a038", text: "#fff" },
  ghost: { bg: "#705898", text: "#fff" },
  dragon: { bg: "#7038f8", text: "#fff" },
  dark: { bg: "#705848", text: "#fff" },
  steel: { bg: "#b8b8d0", text: "#222" },
  fairy: { bg: "#ee99ac", text: "#222" },
  normal: { bg: "#a8a878", text: "#fff" },
};

const ROLE_LABELS: Record<string, string> = {
  offensive_tank: "Off-Tank",
  burst_dd: "BDD",
  otdd: "OTDD",
  tank: "Tank",
  speedster: "Speed",
  support: "Sup",
  disrupter: "Disrupt",
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
  const uncalibrated = Boolean(pokemon.todo);
  const skillCount = pokemon.skills.length;
  const roleLabel = pokemon.role ? ROLE_LABELS[pokemon.role] : null;

  const baseCard = "rounded-lg p-3.5 cursor-pointer border-2 transition-[border-color,transform,box-shadow] duration-150 ease-out hover:-translate-y-0.5 shadow-[var(--shadow-card)]";
  const stateCard = disabled
    ? "opacity-40 cursor-not-allowed bg-bg-card border-[#333] hover:translate-y-0 shadow-none"
    : selected
    ? "bg-border-card border-accent-blue shadow-[0_2px_12px_rgb(74_144_217/0.3)]"
    : "bg-bg-card border-[#333] hover:border-[#555] hover:shadow-[var(--shadow-elevated)]";

  const ccCls = hasCC ? "bg-cc-yes text-white" : "bg-cc-no text-white";

  return (
    <div className={`${baseCard} ${stateCard}`} onClick={() => !disabled && onToggle(pokemon.id)}>
      <div className="flex justify-between items-start gap-2 mb-2">
        <span className="font-semibold text-[0.95rem] leading-tight">{pokemon.name}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {uncalibrated && (
            <span
              className="text-xs cursor-help opacity-85 hover:opacity-100"
              title={
                `Ação pendente: ${pokemon.todo}` +
                (pokemon.observacao ? `\n\nObservação: ${pokemon.observacao}` : "")
              }
            >
              ⚠️
            </span>
          )}
          <span
            className="text-[0.7rem] font-bold px-1.5 py-0.5 rounded text-bg-app"
            style={{ backgroundColor: TIER_COLORS[pokemon.tier] ?? "#888" }}
          >
            {pokemon.tier}
          </span>
        </div>
      </div>

      {pokemon.elements && pokemon.elements.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {pokemon.elements.map((el) => {
            const colors = ELEMENT_COLORS[el] ?? { bg: "#444", text: "#fff" };
            return (
              <span
                key={el}
                className="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide"
                style={{ backgroundColor: colors.bg, color: colors.text }}
              >
                {el}
              </span>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 text-[0.7rem]">
        <span className={`px-2 py-0.5 rounded font-semibold uppercase tracking-wide ${ccCls}`}>
          {cc}
        </span>
        {roleLabel && (
          <span className="px-1.5 py-0.5 rounded bg-white/[0.067] text-text-muted font-semibold uppercase tracking-wide border border-white/[0.13]">
            {roleLabel}
          </span>
        )}
        <span className="text-text-dim ml-auto">
          {skillCount > 0 ? `${skillCount} skills` : "—"}
        </span>
      </div>
    </div>
  );
}
