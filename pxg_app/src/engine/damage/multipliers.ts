import type { ClanName, PokemonElement } from "../../types";
import clansData from "../../data/clans.json";

// =========================================================
// Type effectiveness chart (standard Pokemon — validated in PxG)
// =========================================================

type TypeChart = Record<PokemonElement, Partial<Record<PokemonElement, number>>>;

const TYPE_CHART: TypeChart = {
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
  ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
  poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
  ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
  rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
  dragon: { dragon: 2, steel: 0.5, fairy: 0 },
  dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
  steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
  fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
  // Elemento exclusivo do PxG. Sem dados de efetividade — todas defensivas ficam neutras (1×)
  // até o usuário calibrar. Para definir (attacker crystal vs defender X), preencha aqui.
  // Para defender crystal vs attacker X, adicionar `crystal: <mult>` dentro de TYPE_CHART[X].
  crystal: {},
};

export function getEffectiveness(
  attackerType: PokemonElement,
  defenderType: PokemonElement
): number {
  return TYPE_CHART[attackerType]?.[defenderType] ?? 1;
}

/**
 * PxG usa FULL DUAL-TYPE: multiplica o efeito de cada tipo do defender.
 * Validado empiricamente 2026-04-22:
 * - Mawile [fairy, steel]: fighting NÃO é eff (×2 steel × ×0.5 fairy = 1) ✓
 *   (last-only teria dado ×2, incorreto)
 * - Pidgeot [normal, flying]: rock é eff ×2 (×1 normal × ×2 flying = 2) ✓
 *   (consistente com last-only também, por isso não distinguia)
 * - Sh.Heatmor vs Mawile: fire ×2 (×2 steel × ×1 fairy = 2) ✓
 */
export function computeEffectiveness(
  attackerType: PokemonElement,
  defenderTypes: PokemonElement[]
): number {
  if (defenderTypes.length === 0) return 1;
  return defenderTypes.reduce(
    (acc, t) => acc * getEffectiveness(attackerType, t),
    1
  );
}

// =========================================================
// Clan bonus lookup
// =========================================================

// Pré-indexa clãs → elemento → bônus de atk. Lookup O(1) no hot path.
const CLAN_ATK_BONUS: Map<ClanName, Map<PokemonElement, number>> = new Map(
  clansData.map((c) => [
    c.name as ClanName,
    new Map(c.bonuses.map((b) => [b.element as PokemonElement, b.atk])),
  ])
);

// Pré-indexa clã → elementos (sem bonus). Usado pro engine priorizar starters
// cujo tipo está no clã do jogador (dano maior com clan bonus nas skills STAB).
const CLAN_ELEMENTS: Map<ClanName, PokemonElement[]> = new Map(
  clansData.map((c) => [c.name as ClanName, c.bonuses.map((b) => b.element as PokemonElement)])
);

export function getClanElements(clanName: ClanName | null): PokemonElement[] {
  if (!clanName) return [];
  return CLAN_ELEMENTS.get(clanName) ?? [];
}

export function getClanBonus(
  clanName: ClanName | null,
  skillElement: PokemonElement | undefined
): number {
  if (!clanName || !skillElement) return 0;
  return CLAN_ATK_BONUS.get(clanName)?.get(skillElement) ?? 0;
}
