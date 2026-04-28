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

function ccLabel(pokemon: Pokemon): string {
  // Mostra qualquer CC (incluindo stun/silence frontal, que ainda vale como second).
  const kinds = new Set(pokemon.skills.filter((s) => s.cc !== null).map((s) => s.cc));
  if (kinds.size === 0) return "No CC";
  return Array.from(kinds).join("/");
}

export function PokemonCard({ pokemon, selected, disabled, onToggle }: Props) {
  const cc = ccLabel(pokemon);
  const hasCC = cc !== "No CC";
  // ⚠️ quando tem ação pendente em `todo`. `observacao` é informativo apenas.
  const uncalibrated = Boolean(pokemon.todo);

  const baseCard = "rounded-lg p-2.5 cursor-pointer border-2 transition-[border-color,transform,box-shadow] duration-150 ease-out hover:-translate-y-px shadow-[var(--shadow-card)]";
  const stateCard = disabled
    ? "opacity-40 cursor-not-allowed bg-bg-card border-[#333] hover:translate-y-0 shadow-none"
    : selected
    ? "bg-border-card border-accent-blue shadow-[0_2px_8px_rgb(74_144_217/0.25)]"
    : "bg-bg-card border-[#333] hover:border-[#555] hover:shadow-[var(--shadow-elevated)]";

  const ccCls = hasCC
    ? "bg-cc-yes text-white"
    : "bg-cc-no text-white";

  return (
    <div className={`${baseCard} ${stateCard}`} onClick={() => !disabled && onToggle(pokemon.id)}>
      <div className="flex justify-between items-center mb-2">
        <span className="font-semibold text-sm leading-tight">{pokemon.name}</span>
        {uncalibrated && (
          <span
            className="text-xs ml-auto mr-1.5 cursor-help opacity-85 hover:opacity-100"
            title={
              `Ação pendente: ${pokemon.todo}` +
              (pokemon.observacao ? `\n\nObservação: ${pokemon.observacao}` : "")
            }
          >
            ⚠️
          </span>
        )}
        <span
          className="text-[0.7rem] font-bold px-1.5 py-0.5 rounded text-bg-app shrink-0"
          style={{ backgroundColor: TIER_COLORS[pokemon.tier] ?? "#888" }}
        >
          {pokemon.tier}
        </span>
      </div>

      <div className="flex gap-2 text-[0.7rem]">
        <span className={`px-2 py-0.5 rounded font-semibold uppercase tracking-wide ${ccCls}`}>
          {cc}
        </span>
      </div>
    </div>
  );
}
