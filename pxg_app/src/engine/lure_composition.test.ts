import type { DamageConfig, Pokemon, PokeSetup } from "../types";
import pokemonData from "../data/pokemon.json";
import mobsData from "../data/mobs.json";
import { findBestForBag } from "./rotation";
import { hasAnyCC, hasFrontal, hasHardCC } from "./scoring";

/**
 * Tests pra regras de composição de lure:
 * - Starter: hasHardCC && !hasFrontal
 * - Middle member (second + extras não-últimos): hasAnyCC
 * - Finalizador (último extra do group, ou second da dupla): qualquer poke
 *
 * Rodar: npx tsx src/engine/lure_composition.test.ts
 */

const allPokes = pokemonData as Pokemon[];

function findPoke(name: string): Pokemon {
  const p = allPokes.find((x) => x.name === name);
  if (!p) throw new Error(`Pokemon not found: ${name}`);
  return p;
}

let failures = 0;
function assert(cond: boolean, msg: string) {
  const tag = cond ? "OK" : "FAIL";
  console.log(`  ${tag}: ${msg}`);
  if (!cond) failures++;
}

// =========================================================
// Unit tests: helpers por poke
// =========================================================

console.log("\n=== Helper: hasHardCC (starter CC rule) ===");
assert(hasHardCC(findPoke("Shiny Rampardos")), "Sh.Rampardos (Head Smash area stun) → true");
assert(hasHardCC(findPoke("Rampardos")), "Rampardos (Head Smash area stun) → true");
assert(hasHardCC(findPoke("Shiny Golem")), "Sh.Golem (Steamroller area stun) → true");
assert(hasHardCC(findPoke("Sandaconda")), "Sandaconda (Sand Spit area silence) → true");
assert(!hasHardCC(findPoke("Lycanroc")), "Lycanroc (Howl frontal stun) → false (só frontal)");
assert(!hasHardCC(findPoke("Shiny Donphan")), "Sh.Donphan (nenhuma CC) → false");

console.log("\n=== Helper: hasAnyCC (member CC rule) ===");
assert(hasAnyCC(findPoke("Shiny Rampardos")), "Sh.Rampardos → true (stun área)");
assert(hasAnyCC(findPoke("Shiny Golem")), "Sh.Golem → true");
assert(hasAnyCC(findPoke("Lycanroc")), "Lycanroc → true (frontal stun conta)");
assert(!hasAnyCC(findPoke("Shiny Donphan")), "Sh.Donphan → false (zero CC)");

console.log("\n=== Helper: hasFrontal (starter rejection) ===");
assert(!hasFrontal(findPoke("Shiny Rampardos")), "Sh.Rampardos (todas skills área) → false");
assert(!hasFrontal(findPoke("Shiny Golem")), "Sh.Golem (todas skills área) → false");
assert(!hasFrontal(findPoke("Shiny Donphan")), "Sh.Donphan (todas skills área) → false");
assert(hasFrontal(findPoke("Lycanroc")), "Lycanroc (Howl frontal + Stone Edge frontal) → true");

console.log("\n=== Derived: starter eligibility (hasHardCC && !hasFrontal) ===");
function starterOk(p: Pokemon): boolean {
  return hasHardCC(p) && !hasFrontal(p);
}
assert(starterOk(findPoke("Shiny Rampardos")), "Sh.Rampardos pode ser starter");
assert(starterOk(findPoke("Rampardos")), "Rampardos pode ser starter");
assert(starterOk(findPoke("Shiny Golem")), "Sh.Golem pode ser starter");
assert(!starterOk(findPoke("Lycanroc")), "Lycanroc NÃO pode ser starter (frontal)");
assert(!starterOk(findPoke("Shiny Donphan")), "Sh.Donphan NÃO pode ser starter (sem hard CC)");

// =========================================================
// Rotation scenarios: Donphan position check
// =========================================================

const mobs = mobsData as Array<{
  name: string;
  types: string[];
  hp?: number;
  defFactor?: number;
  bestStarterElements?: string[];
  group?: string;
}>;
const torkoal = mobs.find((m) => m.name === "Torkoal")!;
const pansear = mobs.find((m) => m.name === "Pansear")!;

function setup(boost: number, tier: 0|1|2|3|4|5|6|7|8): PokeSetup {
  return { boost, held: { kind: "x-attack", tier }, hasDevice: false };
}

function buildConfig(bag: Pokemon[], mob = torkoal): DamageConfig {
  return {
    playerLvl: 366,
    clan: "orebound",
    hunt: mob === torkoal ? "400+" : "300",
    mob: {
      name: mob.group ?? mob.name,
      types: mob.types as DamageConfig["mob"]["types"],
      hp: mob.hp ?? 0,
      defFactor: mob.defFactor,
      bestStarterElements: mob.bestStarterElements as DamageConfig["mob"]["bestStarterElements"],
    },
    device: { kind: "x-boost", tier: 7 },
    skillCalibrations: {},
    pokeSetups: Object.fromEntries(bag.map((p) => [p.id, setup(80, 8)])),
  };
}

function analyzeRotation(testName: string, bag: Pokemon[], mob = torkoal): {
  asStarter: Set<string>;
  asSecond: Set<string>;
  asMiddleExtra: Set<string>;
  asLastExtra: Set<string>;
  perLureNoCCCount: number[];
  lureCount: number;
} {
  console.log(`\n=== ${testName} ===`);
  console.log(`  bag: ${bag.map((p) => p.name).join(", ")}`);
  console.log(`  mob: ${mob.name}`);

  const cfg = buildConfig(bag, mob);
  const res = findBestForBag(bag, 2, { damageConfig: cfg });
  if (!res) {
    console.log(`  (no rotation found)`);
    return {
      asStarter: new Set(),
      asSecond: new Set(),
      asMiddleExtra: new Set(),
      asLastExtra: new Set(),
      perLureNoCCCount: [],
      lureCount: 0,
    };
  }

  const asStarter = new Set<string>();
  const asSecond = new Set<string>();
  const asMiddleExtra = new Set<string>();
  const asLastExtra = new Set<string>();
  const perLureNoCCCount: number[] = [];

  for (const step of res.result.steps) {
    const l = step.lure;
    asStarter.add(l.starter.name);
    let noCC = hasAnyCC(l.starter) ? 0 : 1;
    if (l.second) {
      asSecond.add(l.second.name);
      if (!hasAnyCC(l.second)) noCC++;
    }
    const extras = l.extraMembers;
    if (extras.length > 0) {
      for (let i = 0; i < extras.length - 1; i++) asMiddleExtra.add(extras[i].poke.name);
      asLastExtra.add(extras[extras.length - 1].poke.name);
    }
    for (const m of extras) if (!hasAnyCC(m.poke)) noCC++;
    perLureNoCCCount.push(noCC);
    const names = [l.starter.name, l.second?.name, ...extras.map((m) => m.poke.name)]
      .filter(Boolean)
      .join(" → ");
    console.log(`  lure [${l.type}]: ${names}  (no-CC=${noCC})`);
  }

  return { asStarter, asSecond, asMiddleExtra, asLastExtra, perLureNoCCCount, lureCount: res.result.steps.length };
}

// --- Scenario 1: Donphan in bag → never as starter/second/middle, only last extra ---
{
  const bag = [
    findPoke("Shiny Golem"),
    findPoke("Hippowdon Female"),
    findPoke("Shiny Rampardos"),
    findPoke("TR Tyranitar"),
    findPoke("Shiny Donphan"),
  ];
  const r = analyzeRotation("Scenario 1: bag com Donphan (sem CC) + 4 CC pokes", bag);
  assert(!r.asStarter.has("Shiny Donphan"), "Donphan nunca é starter");
  assert(!r.asSecond.has("Shiny Donphan"), "Donphan nunca é second");
  assert(!r.asMiddleExtra.has("Shiny Donphan"), "Donphan nunca é extra do meio");
  // Se Donphan aparecer no rotation, tem que ser como last extra
  const donphanUsed = r.asStarter.has("Shiny Donphan") || r.asSecond.has("Shiny Donphan")
    || r.asMiddleExtra.has("Shiny Donphan") || r.asLastExtra.has("Shiny Donphan");
  // Não exigimos que Donphan apareça — só que SE aparecer, é como last extra
  assert(!donphanUsed || r.asLastExtra.has("Shiny Donphan"),
    "Donphan só aparece como last extra (finalizer)");
}

// --- Scenario 2: Lycanroc never as starter (has frontal) ---
{
  const bag = [
    findPoke("Shiny Golem"),
    findPoke("Rampardos"),
    findPoke("Lycanroc"),
    findPoke("Hippowdon Female"),
  ];
  const r = analyzeRotation("Scenario 2: bag com Lycanroc (frontal) — nunca starter", bag);
  assert(!r.asStarter.has("Lycanroc"), "Lycanroc nunca é starter (tem frontal no kit)");
}

// --- Scenario 3: Dois pokes sem CC na bag + Pansear (damage OK) ---
// Bag = [Sh.Golem, Sh.Rampardos, Sh.Donphan, Sh.Magby] vs Pansear (hunt 300, fácil)
// → cada lure tem no máximo 1 poke sem CC (o finalizador)
{
  const magby = allPokes.find((x) => x.name === "Shiny Magby");
  if (magby) {
    const bag = [
      findPoke("Shiny Golem"),
      findPoke("Shiny Rampardos"),
      findPoke("Shiny Donphan"),
      magby,
    ];
    const r = analyzeRotation("Scenario 3: Donphan + Magby — max 1 no-CC por lure", bag, pansear);
    assert(r.lureCount > 0, "encontrou pelo menos 1 lure válida");
    for (const n of r.perLureNoCCCount) {
      assert(n <= 1, `cada lure tem ≤1 no-CC poke (got ${n})`);
    }
    assert(!r.asStarter.has("Shiny Donphan"), "Donphan não é starter");
    assert(!r.asStarter.has("Shiny Magby"), "Magby não é starter");
    assert(!r.asMiddleExtra.has("Shiny Donphan"), "Donphan não é middle extra");
    assert(!r.asMiddleExtra.has("Shiny Magby"), "Magby não é middle extra");
  } else {
    console.log("\n  SKIP Scenario 3: Shiny Magby não encontrado");
  }
}

console.log(failures === 0 ? "\nAll tests pass ✓" : `\n${failures} FAILURES`);
if (failures > 0) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
