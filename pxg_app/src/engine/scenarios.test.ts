import type { DamageConfig, Pokemon, PokeSetup } from "../types";
import pokemonData from "../data/pokemon.json";
import mobsData from "../data/mobs.json";
import { findBestForBag } from "./rotation";

const allPokemon = pokemonData as Pokemon[];
const mobs = mobsData as Array<{ name: string; types: string[]; hp?: number; defFactor?: number }>;

function findPoke(name: string): Pokemon {
  const p = allPokemon.find((x) => x.name === name);
  if (!p) throw new Error(`Pokemon not found: ${name}`);
  return p;
}

function setup(boost: number, atkTier: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8, hasDevice = false): PokeSetup {
  return { boost, held: { kind: "x-attack", tier: atkTier }, hasDevice };
}

const pinsir = mobs.find((m) => m.name === "Pinsir");
if (!pinsir) throw new Error("Pinsir not in mobs.json");

const baseConfig: Omit<DamageConfig, "pokeSetups"> = {
  playerLvl: 600,
  clan: "volcanic",
  hunt: "400+",
  mob: {
    name: "Pinsir",
    types: pinsir.types as DamageConfig["mob"]["types"],
    hp: pinsir.hp ?? 0,
    defFactor: pinsir.defFactor,
  },
  device: { kind: "none", tier: 0 },
  skillCalibrations: {},
};

interface Scenario {
  name: string;
  bag: { poke: Pokemon; setup: PokeSetup }[];
}

const scenarios: Scenario[] = [
  {
    name: "1. Sh.Heatmor +80/T8 + Ninetales +70/T8 + (Shiny Ninetales missing — using Ninetales 2×)",
    bag: [
      { poke: findPoke("Shiny Heatmor"), setup: setup(80, 8) },
      { poke: findPoke("Ninetales"), setup: setup(70, 8) },
    ],
  },
  {
    name: "2. Sh.Heatmor +80/T8 + TR Charizard +70/T8 + Sh.Chandelure +70/T8",
    bag: [
      { poke: findPoke("Shiny Heatmor"), setup: setup(80, 8) },
      { poke: findPoke("TR Charizard"), setup: setup(70, 8) },
      { poke: findPoke("Shiny Chandelure"), setup: setup(70, 8) },
    ],
  },
  {
    name: "3. Sh.Heatmor +80/T8 + Sh.Magby +70/T8 (Heatmor usa elixir)",
    bag: [
      { poke: findPoke("Shiny Heatmor"), setup: setup(80, 8) },
      { poke: findPoke("Shiny Magby"), setup: setup(70, 8) },
    ],
  },
];

for (const sc of scenarios) {
  console.log(`\n=== ${sc.name} ===`);
  const pokeSetups: DamageConfig["pokeSetups"] = {};
  for (const { poke, setup: s } of sc.bag) pokeSetups[poke.id] = s;
  const cfg: DamageConfig = { ...baseConfig, pokeSetups };
  const bag = sc.bag.map((x) => x.poke);

  const res = findBestForBag(bag, 4, { damageConfig: cfg });
  if (!res) {
    console.log("  → NO viable rotation (bag filtered out by damage check)");
    continue;
  }
  const { result } = res;
  const boxesPerHour = Math.round((3600 * result.steps.length) / result.totalTime);
  console.log(`  → ${result.steps.length} lures | totalTime ${result.totalTime.toFixed(1)}s | ${boxesPerHour} boxes/h`);
  result.steps.forEach((step, i) => {
    const l = step.lure;
    const pokes = l.second ? `${l.starter.name} + ${l.second.name}` : l.starter.name;
    const fin = l.usesDevice ? "Dev" : l.usesElixirAtk ? "Elixir" : "Dupla";
    console.log(`    ${i + 1}. ${pokes.padEnd(40)} [${fin}]`);
  });
}
