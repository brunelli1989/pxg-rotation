import { useMemo, useState } from "react";
import type { Pokemon, PokemonElement, Tier } from "../types";
import { PokemonCard } from "./PokemonCard";

const ALL_ELEMENTS: PokemonElement[] = [
  "normal", "fire", "water", "electric", "grass", "ice",
  "fighting", "poison", "ground", "flying", "psychic", "bug",
  "rock", "ghost", "dragon", "dark", "steel", "fairy",
  "crystal",
];

const ALL_TIERS: Tier[] = ["T1A", "T1B", "T1H", "T1C", "T2", "T3", "TM", "TR"];

// Cores PxG-canon por elemento. `bg`/`text` aplicados sempre que chip representa o tipo.
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

interface Props {
  allPokemon: Pokemon[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  elementsByPokeId: Record<string, string[]>;
}

export function PokemonSelector({ allPokemon, selectedIds, onToggle, elementsByPokeId }: Props) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [tierFilter, setTierFilter] = useState<Tier | "">("");

  const filtered = useMemo(() => {
    let list = allPokemon;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    if (typeFilter) {
      list = list.filter((p) => (elementsByPokeId[p.id] ?? []).includes(typeFilter));
    }
    if (tierFilter) {
      list = list.filter((p) => p.tier === tierFilter);
    }
    return list;
  }, [allPokemon, search, typeFilter, tierFilter, elementsByPokeId]);

  // Seleciona primeiro os marcados, depois o resto (filtrado)
  const sorted = useMemo(() => {
    const selected = filtered.filter((p) => selectedIds.includes(p.id));
    const rest = filtered.filter((p) => !selectedIds.includes(p.id));
    return [...selected, ...rest];
  }, [filtered, selectedIds]);

  const baseChip = "px-2.5 py-1 rounded-[14px] text-[0.75rem] cursor-pointer capitalize border transition-[background,border-color] duration-150 hover:brightness-110";
  const tierChipClasses = (active: boolean) =>
    active
      ? `${baseChip} bg-accent-blue text-white border-white shadow-[0_0_0_2px_#fff]`
      : `${baseChip} bg-bg-skills text-text border-[#333]`;

  return (
    <section>
      <h2 className="text-lg font-semibold mb-3 text-text">
        Selecione seus Pokémon disponíveis{" "}
        <span className="text-accent-blue-light text-base font-normal">
          ({selectedIds.length} selecionados)
        </span>
      </h2>

      <input
        type="text"
        className="w-full bg-bg-skills text-text placeholder:text-text-faint border border-[#444] focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue-soft px-3.5 py-2.5 rounded-md text-[0.9rem] mb-3 transition-[border-color,box-shadow]"
        placeholder={`Buscar em ${allPokemon.length} pokémons...`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="flex flex-wrap gap-1.5 mb-3">
        <button
          className={tierChipClasses(tierFilter === "")}
          onClick={() => setTierFilter("")}
        >
          todos tiers
        </button>
        {ALL_TIERS.map((t) => (
          <button
            key={t}
            className={tierChipClasses(tierFilter === t)}
            onClick={() => setTierFilter(tierFilter === t ? "" : t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        <button
          className={tierChipClasses(typeFilter === "")}
          onClick={() => setTypeFilter("")}
        >
          todos
        </button>
        {ALL_ELEMENTS.map((t) => {
          const active = typeFilter === t;
          const colors = ELEMENT_COLORS[t];
          const style = colors
            ? {
                backgroundColor: colors.bg,
                color: colors.text,
                borderColor: active ? "#fff" : colors.bg,
                boxShadow: active ? "0 0 0 2px #fff" : undefined,
              }
            : undefined;
          return (
            <button
              key={t}
              className={baseChip + (colors ? "" : (active ? " bg-accent-blue text-white border-white shadow-[0_0_0_2px_#fff]" : " bg-bg-skills text-text border-[#333]"))}
              style={style}
              onClick={() => setTypeFilter(active ? "" : t)}
            >
              {t}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5 mb-4 max-h-[400px] overflow-y-auto pr-1">
        {sorted.map((p) => {
          const isSelected = selectedIds.includes(p.id);
          return (
            <PokemonCard
              key={p.id}
              pokemon={p}
              selected={isSelected}
              disabled={false}
              onToggle={onToggle}
            />
          );
        })}
      </div>

      {sorted.length === 0 && (
        <p className="text-[0.8rem] text-[#666] mt-1">Nenhum pokémon encontrado</p>
      )}
      {selectedIds.length === 0 && sorted.length > 0 && (
        <p className="text-[0.8rem] text-[#666] mt-1">Clique nos pokémons acima para selecionar</p>
      )}
    </section>
  );
}
