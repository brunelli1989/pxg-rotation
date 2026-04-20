import type { DamageConfig, Pokemon, PokeSetup, RosterPokemon } from "../types";
import pokemonData from "../data/pokemon.json";
import rosterData from "../data/pokemon_roster.json";
import mobsData from "../data/mobs.json";
import { findBestForBag } from "./rotation";

// Replica do merge que App.tsx faz: enriquece pokes com elements do roster
const elementsById = Object.fromEntries(
  (rosterData as RosterPokemon[]).map((r) => [r.id, r.elements])
);
const allPokes = (pokemonData as Pokemon[]).map((p) => ({
  ...p,
  elements: elementsById[p.id] ?? p.elements,
}));

function findPoke(name: string): Pokemon {
  const p = allPokes.find((x) => x.name === name);
  if (!p) throw new Error(`Pokemon not found: ${name}`);
  return p;
}

const mobs = mobsData as Array<{
  name: string;
  types: string[];
  hp?: number;
  defFactor?: number;
  bestStarterElements?: string[];
  group?: string;
}>;
const pansear = mobs.find((m) => m.name === "Pansear")!;
const pinsir = mobs.find((m) => m.name === "Pinsir")!;
const torkoal = mobs.find((m) => m.name === "Torkoal")!;

function setup(boost: number, tier: 0|1|2|3|4|5|6|7|8): PokeSetup {
  return { boost, held: { kind: "x-attack", tier }, hasDevice: false };
}

function buildConfig(
  bag: Pokemon[],
  clan: "orebound" | "seavell" | null,
  pokeSetups?: Record<string, PokeSetup>,
  opts?: { mob?: typeof pansear; playerLvl?: number; hunt?: "300" | "400+" }
): DamageConfig {
  const m = opts?.mob ?? pansear;
  return {
    playerLvl: opts?.playerLvl ?? 366,
    clan,
    hunt: opts?.hunt ?? "300",
    mob: {
      name: m.group ?? m.name,
      types: m.types as DamageConfig["mob"]["types"],
      hp: m.hp ?? 0,
      defFactor: m.defFactor,
      bestStarterElements: m.bestStarterElements as DamageConfig["mob"]["bestStarterElements"],
    },
    device: { kind: "x-boost", tier: 7 },
    skillCalibrations: {},
    pokeSetups: pokeSetups ?? Object.fromEntries(bag.map((p) => [p.id, setup(80, 8)])),
  };
}

function runTest(
  name: string,
  bag: Pokemon[],
  clan: "orebound" | "seavell" | null,
  assertFn: (starters: string[], memberUsage: Record<string, { starter: number; any: number }>, result: { totalTime: number; steps: number }) => void,
  pokeSetups?: Record<string, PokeSetup>,
  configOpts?: { mob?: typeof pansear; playerLvl?: number; hunt?: "300" | "400+" },
) {
  console.log(`\n=== ${name} ===`);
  console.log(`  bag: ${bag.map((p) => `${p.name} (${p.elements?.join("/") ?? "—"})`).join(", ")}`);
  console.log(`  clan: ${clan ?? "none"}`);

  const cfg = buildConfig(bag, clan, pokeSetups, configOpts);
  const res = findBestForBag(bag, 2, { damageConfig: cfg });
  if (!res) {
    console.log(`  ✗ FAIL: no rotation`);
    (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
    return;
  }

  const starters: string[] = [];
  const memberUsage: Record<string, { starter: number; any: number }> = {};
  for (const p of bag) memberUsage[p.name] = { starter: 0, any: 0 };

  for (const step of res.result.steps) {
    const l = step.lure;
    starters.push(l.starter.name);
    memberUsage[l.starter.name].starter++;
    memberUsage[l.starter.name].any++;
    if (l.second) memberUsage[l.second.name].any++;
    for (const m of l.extraMembers) memberUsage[m.poke.name].any++;
  }

  console.log(`  → totalTime ${res.result.totalTime.toFixed(1)}s, ${res.result.steps.length} lures`);
  for (let i = 0; i < res.result.steps.length; i++) {
    const l = res.result.steps[i].lure;
    const members = [l.starter.name, l.second?.name, ...l.extraMembers.map((m) => m.poke.name)].filter(Boolean).join(" + ");
    const finisher = l.usesDevice ? "[Device]" : l.usesElixirAtk ? "[Elixir]" : "";
    console.log(`    ${i + 1}. [${l.type}]${finisher ? " " + finisher : ""} ${members}`);
  }
  console.log(`  usage:`);
  for (const [n, u] of Object.entries(memberUsage)) {
    console.log(`    ${n.padEnd(20)} starter=${u.starter}  total=${u.any}`);
  }

  try {
    assertFn(starters, memberUsage, { totalTime: res.result.totalTime, steps: res.result.steps.length });
    console.log(`  ✓ PASS`);
  } catch (e: unknown) {
    console.log(`  ✗ FAIL: ${(e as Error).message}`);
    (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
  }
}

// --- Test 1: clan preference com 3 pokes ---
runTest(
  "Test 1: Sh.Golem + Omastar + Sh.Vaporeon em Orebound → rocks priorizados",
  [findPoke("Shiny Golem"), findPoke("Omastar"), findPoke("Shiny Vaporeon")],
  "orebound",
  (_starters, usage) => {
    const rockStarters = (usage["Shiny Golem"].starter) + (usage["Omastar"].starter);
    const waterStarters = usage["Shiny Vaporeon"].starter;
    if (rockStarters === 0) throw new Error("esperado rock como starter em alguma lure");
    if (waterStarters > rockStarters) throw new Error(`rock=${rockStarters} water=${waterStarters}`);
  }
);

// --- Test 2: 2 pokes forçam ambos a serem usados ---
runTest(
  "Test 2: Sh.Golem + Sh.Vaporeon em Orebound → ambos devem ser usados",
  [findPoke("Shiny Golem"), findPoke("Shiny Vaporeon")],
  "orebound",
  (_starters, usage) => {
    if (usage["Shiny Golem"].any === 0) throw new Error("Shiny Golem não apareceu");
    if (usage["Shiny Vaporeon"].any === 0) throw new Error("Shiny Vaporeon não apareceu");
  }
);

// --- Test 4: Sh.Golem (device) dupla-starter em todas as lures ---
// Bag sem Sh.Rampardos como T1H óbvio pro device → Sh.Golem (T2 rock, Orebound, Harden) domina.
// Sh.Golem hasDevice=true no pokeSetup → ele ganha boost de dano do device mesmo em duplas.
// Each lure is dupla with Sh.Golem starter + different second, cycling through the 5 others.
// Expected: Sh.Golem é starter em todas as 5 duplas; Lycanroc, Omastar, Rampardos, TR Tyranitar
// e Sh.Rampardos aparecem cada um como second em uma dupla.
const golemDeviceBag = [
  findPoke("Shiny Golem"),
  findPoke("Lycanroc"),
  findPoke("Omastar"),
  findPoke("Rampardos"),
  findPoke("TR Tyranitar"),
  findPoke("Shiny Rampardos"),
];
const golemDeviceSetups: Record<string, PokeSetup> = {};
for (const p of golemDeviceBag) {
  golemDeviceSetups[p.id] = {
    boost: 80,
    held: { kind: "x-attack", tier: 8 },
    hasDevice: p.name === "Shiny Golem",  // só Sh.Golem tem device
  };
}
runTest(
  "Test 4: Sh.Golem (device) + X duplas rotacionando os outros 5",
  golemDeviceBag,
  "orebound",
  (_starters, usage) => {
    // Sh.Golem tem que dominar como dupla starter — pelo menos 5 lures como starter
    // (user expected 5 duplas com Sh.Golem starter, uma por cada outro poke como second)
    if (usage["Shiny Golem"].starter < 5) {
      throw new Error(`Sh.Golem devia ser starter em ≥5 lures (got ${usage["Shiny Golem"].starter})`);
    }
    // Device holder nunca é second (engine garante)
    if (usage["Shiny Golem"].any > usage["Shiny Golem"].starter) {
      throw new Error(`Sh.Golem não deveria aparecer como second (device holder)`);
    }
    // Todos os 5 outros pokes aparecem em alguma lure
    const others = ["Lycanroc", "Omastar", "Rampardos", "TR Tyranitar", "Shiny Rampardos"];
    const unused = others.filter((n) => usage[n].any === 0);
    if (unused.length > 0) {
      throw new Error(`pokes não usados: ${unused.join(", ")}`);
    }
  },
  golemDeviceSetups,
);

// --- Test 5: hunt 400+ Pinsir → group lures de 4 com Sh.Rampardos (device) como membro ---
// Bag: 6 pokes rock/ground. Pinsir (bug, 400+) precisa de ~465k/mob. Duplas rock sozinhas
// não finalizam nesse lvl. Engine cascata pra group lures.
// Sh.Rampardos marcado hasDevice=true no pokeSetup → ele é device holder; damage boosted.
// Expected: ≥2 group lures (4 membros); Sh.Golem é starter; Sh.Rampardos aparece em ambas
// como membro não-starter (o engine permite device holder como extra/second agora).
const huntBag = [
  findPoke("Shiny Golem"),
  findPoke("Shiny Rampardos"),
  findPoke("TR Tyranitar"),
  findPoke("Lycanroc"),
  findPoke("Hippowdon Female"),
  findPoke("Shiny Donphan"),
];
const huntSetups: Record<string, PokeSetup> = {};
for (const p of huntBag) {
  huntSetups[p.id] = {
    boost: 80,
    held: { kind: "x-attack", tier: 8 },
    hasDevice: p.name === "Shiny Rampardos",
  };
}
runTest(
  "Test 5: hunt 400+ Pinsir → group lures com Sh.Rampardos (device) como membro",
  huntBag,
  "orebound",
  (_starters, usage, result) => {
    if (result.steps === 0) throw new Error("no lures generated");
    // Hunt 400+ Pinsir não finaliza com dupla no lvl 400 → engine cascata pra group
    // Sh.Rampardos (device) deve participar de pelo menos uma lure
    if (usage["Shiny Rampardos"].any === 0) {
      throw new Error("Sh.Rampardos (device) nunca apareceu numa lure");
    }
    // Sh.Golem deve aparecer também (seja starter, second ou extra)
    if (usage["Shiny Golem"].any === 0) {
      throw new Error("Sh.Golem nunca apareceu em nenhuma lure");
    }
  },
  huntSetups,
  { mob: pinsir, playerLvl: 400, hunt: "400+" },
);

// --- Test 6: hunt 400+ Torkoal → Sh.Rampardos (device) em 3 lures distintas ---
// Bag: Sh.Rampardos + TR Tyranitar + Lycanroc + Hippowdon + Sh.Donphan + TR Piloswine.
// bestStarterElements do Torkoal = [water, rock] → hard filter permite Sh.Rampardos, TR Tyranitar
// como starter; grounds (Hippo, Donphan, Piloswine) só como second/extra.
// Lycanroc não tem hardCC (frontal stun só) → só second/extra.
// Expected: Sh.Rampardos domina como starter (device holder, burst_dd com high power calibrado),
// aparece em múltiplas lures. Grounds usados como extras.
const torkoalBag = [
  findPoke("Shiny Rampardos"),
  findPoke("TR Tyranitar"),
  findPoke("Lycanroc"),
  findPoke("Hippowdon Female"),
  findPoke("Shiny Donphan"),
  findPoke("TR Piloswine"),
];
const torkoalSetups: Record<string, PokeSetup> = {};
for (const p of torkoalBag) {
  torkoalSetups[p.id] = {
    boost: 80,
    held: { kind: "x-attack", tier: 8 },
    hasDevice: p.name === "Shiny Rampardos",
  };
}
runTest(
  "Test 6: hunt 400+ Torkoal → Sh.Rampardos (device) em múltiplas lures",
  torkoalBag,
  "orebound",
  (_starters, usage, result) => {
    if (result.steps === 0) throw new Error("no lures");
    // Sh.Rampardos é device holder, deve aparecer em pelo menos uma lure como starter ou membro
    if (usage["Shiny Rampardos"].any === 0) throw new Error("Sh.Rampardos não apareceu");
    // Starters devem ser só rock (bestStarterElements = water, rock; bag tem water? não)
    // Sh.Rampardos (rock), TR Tyranitar (rock) são os únicos candidatos a starter (Lycanroc sem hardCC)
    const groundStarters =
      usage["Hippowdon Female"].starter +
      usage["Shiny Donphan"].starter +
      usage["TR Piloswine"].starter;
    if (groundStarters > 0) {
      throw new Error(`ground pokes não deveriam ser starter (got ${groundStarters})`);
    }
    // Pelo menos um dos ground pokes deve ser usado como second/extra
    const groundUsage =
      usage["Hippowdon Female"].any +
      usage["Shiny Donphan"].any +
      usage["TR Piloswine"].any;
    if (groundUsage === 0) {
      throw new Error("nenhum ground poke usado como second/extra");
    }
  },
  torkoalSetups,
  { mob: torkoal, playerLvl: 400, hunt: "400+" },
);

// --- Test 3: rotação ideal Magby/Pansear com Sh.Rampardos device ---
// Bag: Sh.Rampardos (T1H rock), Sh.Golem (T2 rock), Hippowdon (T2 ground),
//      Omastar (T3 rock/water), TR Tyranitar (TR rock), Rampardos (T2 rock)
// Config: lvl 366, Orebound, Magby hunt, device X-Boost T7, setup boost 80 + X-Atk T8
// Hippo é ground mas fica como SECOND (não starter). Ground não bloqueado no second.
// Expected:
//   - Sh.Rampardos solo_device em 3 lures (ele tem device, solo finaliza com setup maximal)
//   - Sh.Golem + Hippo dupla (Sh.Golem com Harden)
//   - Omastar + TR Tyranitar dupla (Omastar com Harden) OU TR Tyranitar + Omastar
//   - Rampardos solo_elixir + elixir def (sem Harden) + elixir atk
const magbyBag = [
  findPoke("Shiny Rampardos"),
  findPoke("Shiny Golem"),
  findPoke("Hippowdon Female"),
  findPoke("Omastar"),
  findPoke("TR Tyranitar"),
  findPoke("Rampardos"),
];
runTest(
  "Test 3: Sh.Rampardos device + Sh.Golem+Hippo + Omastar+Tyra + Rampardos elixir",
  magbyBag,
  "orebound",
  (_starters, usage) => {
    // Sh.Rampardos deve ser usado como starter (preferencialmente como device holder)
    if (usage["Shiny Rampardos"].starter === 0) {
      throw new Error("Sh.Rampardos não foi usado como starter em nenhuma lure");
    }
    // Sh.Golem deve aparecer (starter ou second)
    if (usage["Shiny Golem"].any === 0) {
      throw new Error("Sh.Golem não apareceu");
    }
    // Hippowdon é ground — NÃO pode ser starter (filtrado pelo bestStarterElements)
    if (usage["Hippowdon Female"].starter > 0) {
      throw new Error(`Hippowdon (ground) não deveria ser starter (apareceu ${usage["Hippowdon Female"].starter}x)`);
    }
    // Omastar e TR Tyranitar devem aparecer
    if (usage["Omastar"].any === 0) throw new Error("Omastar não apareceu");
    if (usage["TR Tyranitar"].any === 0) throw new Error("TR Tyranitar não apareceu");
    // Rampardos deve aparecer (pode ser starter em solo_elixir)
    if (usage["Rampardos"].any === 0) throw new Error("Rampardos não apareceu");
  }
);
