import type { DamageConfig, Pokemon, RosterPokemon } from "../types";
import pokemonData from "../data/pokemon.json";
import rosterData from "../data/pokemon_roster.json";
import { findBestForBag } from "./rotation";

// Replica do merge que App.tsx faz: enriquece pokes com elements do roster
const elementsById: Record<string, RosterPokemon["elements"]> = Object.fromEntries(
  (rosterData as RosterPokemon[]).map((r) => [r.id, r.elements])
);
const pokes: Pokemon[] = (pokemonData as unknown as Pokemon[]).map((p) => ({
  ...p,
  elements: elementsById[p.id] ?? p.elements,
}));
const get = (id: string) => {
  const p = pokes.find((x) => x.id === id);
  if (!p) throw new Error(`missing ${id}`);
  return p;
};

let failures = 0;
function assert(name: string, condition: boolean, details: string) {
  const mark = condition ? "✓" : "✗";
  console.log(`  ${mark} ${name}: ${details}`);
  if (!condition) failures++;
}

// =========================================================
// Regression: wrap-check bug (cycleHas3ConsecutiveIdentical)
// Antes do fix, engine convergia em ciclo 12-lure (79 b/h) pra bag pesada em
// T1H+device porque o wrap-check bloqueava o ótimo 6-lure (81 b/h). Verifica
// que o engine agora encontra a rotação curta.
// =========================================================
console.log("\nBag Orebound lvl 369 Magby (Sh.Ramp + 5 rock/ground) — wrap-check regression:");

const bag = [
  get("shiny-rampardos"),
  get("hippowdon-female"),
  get("omastar"),
  get("rampardos"),
  get("shiny-golem"),
  get("tyranitar"),
];

const cfg: DamageConfig = {
  playerLvl: 369,
  clan: "orebound",
  hunt: "300",
  mob: {
    name: "Magby",
    types: ["fire"],
    hp: 216450,
    defFactor: 0.9,
    bestStarterElements: ["water", "rock"],
  },
  device: { kind: "x-boost", tier: 7 },
  pokeSetups: Object.fromEntries(
    bag.map((p) => [p.id, {
      boost: 70,
      held: { kind: "x-attack" as const, tier: 7 as const },
      hasDevice: false,
    }])
  ),
  skillCalibrations: {},
  revive: "none",
  useElixirAtk: true,
};

const result = findBestForBag(bag, 2, { beamWidth: 120, maxCycleLen: 12, damageConfig: cfg });
if (!result) {
  console.log("  ✗ FAIL: no rotation found");
  failures++;
} else {
  const nLures = result.result.steps.length;
  const cycleTime = result.result.totalTime;
  const bph = (3600 * nLures) / cycleTime;

  // Verificado por brute-force enumeration de 2M combinações 6-lure: ótimo global é 81.084 b/h.
  assert(
    "boxes/h >= 81.0 (ótimo é 81.084 via brute-force)",
    bph >= 81.0,
    `got ${bph.toFixed(2)} b/h`,
  );

  // Ciclo 12-lure indica que o wrap-check voltou a bloquear — bug regression.
  assert(
    "ciclo <= 6 lures (wrap-check removido)",
    nLures <= 6,
    `got ${nLures} lures`,
  );

  // Rotação ótima usa Sh.Rampardos como device holder.
  assert(
    "device holder = shiny-rampardos",
    result.result.devicePokemonId === "shiny-rampardos",
    `got ${result.result.devicePokemonId}`,
  );

  // Rotação ótima inclui 3 Sh.Ramp solo_device (2 consecutive + 1 wrap-consecutive).
  const shRampDeviceCount = result.result.steps.filter(
    (s) => s.lure.type === "solo_device" && s.lure.starter.id === "shiny-rampardos",
  ).length;
  assert(
    "Sh.Ramp solo_device aparece 3× no ciclo",
    shRampDeviceCount === 3,
    `got ${shRampDeviceCount}`,
  );
}

// =========================================================
// Summary
// =========================================================
console.log(`\n=== Beam-search tests: ${failures === 0 ? "PASSED" : `${failures} FAILED`} ===`);
if (failures > 0) throw new Error(`${failures} assertion(s) failed`);
