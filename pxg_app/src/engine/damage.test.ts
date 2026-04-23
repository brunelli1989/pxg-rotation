import type { DamageConfig, Pokemon, Skill } from "../types";
import { computeSkillDamage, deriveSkillPower } from "./damage";

const shinyRampardos: Pokemon = {
  id: "shiny-rampardos",
  name: "Shiny Rampardos",
  tier: "T1H",
  role: "burst_dd",
  skills: [],
};

/**
 * Validação contra dados reais medidos em combate.
 * Rodar com: npx tsx src/engine/damage.test.ts
 * (ou criar um pequeno harness de teste)
 */

const cfgChar1Orebound: DamageConfig = {
  playerLvl: 364,
  clan: "orebound",
  hunt: "300",
  mob: { name: "dummy", types: ["psychic"], hp: 0, defFactor: 1 }, // dummy neutro
  device: { kind: "x-attack", tier: 4 },
  pokeSetups: {
    "shiny-rampardos": { boost: 70, held: { kind: "x-attack", tier: 7 }, hasDevice: false },
  },
  skillCalibrations: {},
};

const cfgChar2NoClan: DamageConfig = {
  playerLvl: 600,
  clan: null,
  hunt: "300",
  mob: { name: "dummy", types: ["psychic"], hp: 0, defFactor: 1 },
  device: { kind: "x-attack", tier: 4 },
  pokeSetups: {
    "shiny-rampardos": { boost: 70, held: { kind: "x-attack", tier: 7 }, hasDevice: false },
  },
  skillCalibrations: {},
};

const rockWrecker: Skill = {
  name: "Rock Wrecker",
  cooldown: 50,
  type: "area",
  cc: null,
  buff: null,
  element: "rock",
};

// Step 1: derive skill_power from char1 observation
const observedChar1 = 25400;
const derivedPower = deriveSkillPower(observedChar1, cfgChar1Orebound, "shiny-rampardos", rockWrecker);
console.log(`Derived skill_power (Sh.Ramp RW): ${derivedPower.toFixed(3)}`);
// Esperado: ~26.07

// Step 2: predict char 2 using derived power
const rockWreckerCal: Skill = { ...rockWrecker, power: derivedPower };
const predictedChar2 = computeSkillDamage(cfgChar2NoClan, shinyRampardos, rockWreckerCal);
const observedChar2 = 28185;
const errChar2 = Math.abs(predictedChar2 - observedChar2) / observedChar2;
console.log(`Sh.Ramp RW char 2: predito ${predictedChar2.toFixed(0)}, obs ${observedChar2}, err ${(errChar2 * 100).toFixed(2)}%`);
// Esperado: <1% error

// Step 3: Device validation
const cfgWithDevice: DamageConfig = {
  ...cfgChar1Orebound,
  pokeSetups: {
    "shiny-rampardos": { boost: 70, held: { kind: "x-attack", tier: 7 }, hasDevice: true },
  },
  skillCalibrations: { "shiny-rampardos:Rock Wrecker": derivedPower },
};
const predictedDevice = computeSkillDamage(cfgWithDevice, shinyRampardos, rockWreckerCal);
const observedDevice = 29148;
const errDevice = Math.abs(predictedDevice - observedDevice) / observedDevice;
console.log(`Sh.Ramp RW com device: predito ${predictedDevice.toFixed(0)}, obs ${observedDevice}, err ${(errDevice * 100).toFixed(2)}%`);

// Step 4: Type effectiveness (rock vs fire = 2x)
const cfgFireMob: DamageConfig = {
  ...cfgChar1Orebound,
  mob: { name: "fire dummy", types: ["fire"], hp: 0, defFactor: 1 },
  skillCalibrations: { "shiny-rampardos:Rock Wrecker": derivedPower },
};
const predictedFire = computeSkillDamage(cfgFireMob, shinyRampardos, rockWreckerCal);
const observedFire = 50778;
const errFire = Math.abs(predictedFire - observedFire) / observedFire;
console.log(`Sh.Ramp RW em fire dummy: predito ${predictedFire.toFixed(0)}, obs ${observedFire}, err ${(errFire * 100).toFixed(2)}%`);

// Step 5: Combat context (Pansear, fire, def 0.8996)
const cfgPansear: DamageConfig = {
  ...cfgChar1Orebound,
  mob: { name: "Pansear", types: ["fire"], hp: 0, defFactor: 0.8996 },
  skillCalibrations: { "shiny-rampardos:Rock Wrecker": derivedPower },
};
const predictedPansear = computeSkillDamage(cfgPansear, shinyRampardos, rockWreckerCal);
const observedPansear = 45677;
const errPansear = Math.abs(predictedPansear - observedPansear) / observedPansear;
console.log(`Sh.Ramp RW em Pansear: predito ${predictedPansear.toFixed(0)}, obs ${observedPansear}, err ${(errPansear * 100).toFixed(2)}%`);

// Step 6: Pansear + device
const cfgPansearDevice: DamageConfig = {
  ...cfgPansear,
  pokeSetups: { "shiny-rampardos": { boost: 70, held: { kind: "x-attack", tier: 7 }, hasDevice: true } },
};
const predictedPansearDevice = computeSkillDamage(cfgPansearDevice, shinyRampardos, rockWreckerCal);
const observedPansearDevice = 52476;
const errPansearDevice = Math.abs(predictedPansearDevice - observedPansearDevice) / observedPansearDevice;
console.log(`Sh.Ramp RW em Pansear + device: predito ${predictedPansearDevice.toFixed(0)}, obs ${observedPansearDevice}, err ${(errPansearDevice * 100).toFixed(2)}%`);

// Step 7: X-Boost device (2X rule, validado 2026-04-20)
// Wiki: X-Boost "aumenta o bônus do Pokémon em X e o DOBRO desse valor como bônus de ataque".
// T7 @ lvl 366 (range 150-399) → tabela X=36, eff_boost contribution = 72.
// Sh.Rampardos FR 24.28, Torkoal def 0.55, fire 2x eff, X-Atk T7 + device X-Boost T7.
const falling: Skill = {
  name: "Falling Rocks",
  cooldown: 40,
  type: "area",
  cc: null,
  buff: null,
  element: "rock",
  power: 24.28,
};
const cfgXBoost: DamageConfig = {
  playerLvl: 366,
  clan: "orebound",
  hunt: "400+",
  mob: { name: "Torkoal", types: ["fire"], hp: 439109, defFactor: 0.55 },
  device: { kind: "x-boost", tier: 7 },
  pokeSetups: {
    "shiny-rampardos": { boost: 70, held: { kind: "x-attack", tier: 7 }, hasDevice: true },
  },
  skillCalibrations: {},
};
const predictedXBoost = computeSkillDamage(cfgXBoost, shinyRampardos, falling);
const observedXBoost = 29783;
const errXBoost = Math.abs(predictedXBoost - observedXBoost) / observedXBoost;
console.log(`Sh.Ramp FR + device X-Boost T7: predito ${predictedXBoost.toFixed(0)}, obs ${observedXBoost}, err ${(errXBoost * 100).toFixed(2)}%`);
// Esperado ~29,940 com 2X rule; sem a correção seria ~27,939 (+6.6% off).

// Step 8: Dual-type defender rule (validado 2026-04-20 com Pidgeot)
// PxG usa só o ÚLTIMO tipo listado. Pidgeot [normal, flying] → rock SE (2×) via Flying.
// Observado: full combo Sh.Rampardos (5 skills, Σ power=119.49) em 3 Pidgeots = 408.3k total
// → 136.1k per mob → def = 0.587 @ eff=2.
const pidgeotFR: Skill = { ...falling };
const cfgPidgeot: DamageConfig = {
  playerLvl: 366,
  clan: "orebound",
  hunt: "400+",
  mob: { name: "Pidgeot", types: ["normal", "flying"], hp: 468889, defFactor: 0.59 },
  device: { kind: "x-boost", tier: 7 },
  pokeSetups: {
    "shiny-rampardos": { boost: 70, held: { kind: "x-attack", tier: 7 }, hasDevice: false },
  },
  skillCalibrations: {},
};
const predictedPidgeot = computeSkillDamage(cfgPidgeot, shinyRampardos, pidgeotFR);
const observedPidgeotFR = 27684; // @ def=0.587, scaled pra 0.59: 27684 × (0.59/0.587) ≈ 27,826
const errPidgeot = Math.abs(predictedPidgeot - observedPidgeotFR) / observedPidgeotFR;
console.log(`Sh.Ramp FR em Pidgeot (dual-type rule): predito ${predictedPidgeot.toFixed(0)}, obs ~${observedPidgeotFR}, err ${(errPidgeot * 100).toFixed(2)}%`);
// Sem a fix (eff=1.0 antigo): predito ~14k → erro ~50%.

// =========================================================
// Validation session 2026-04-22 pt2 — formula components isolation tests
// Cada teste varia UMA variável mantendo resto constante pra isolar o termo.
// =========================================================

let failures = 0;
const TOLERANCE = 0.01; // 1%

function assert(name: string, observed: number, predicted: number) {
  const err = Math.abs(predicted - observed) / observed;
  const ok = err <= TOLERANCE;
  const mark = ok ? "✓" : "✗";
  console.log(`  ${mark} ${name}: predito ${predicted.toFixed(0)}, obs ${observed}, err ${(err * 100).toFixed(2)}%`);
  if (!ok) failures++;
}

const florges: Pokemon = {
  id: "florges",
  name: "Florges",
  tier: "T2",
  role: "offensive_tank",
  skills: [],
};

const ninetales: Pokemon = {
  id: "ninetales",
  name: "Ninetales",
  tier: "T2",
  role: "burst_dd",
  skills: [],
};

const heatmor: Pokemon = {
  id: "shiny-heatmor",
  name: "Shiny Heatmor",
  tier: "T1H",
  role: "burst_dd",
  skills: [],
};

// ---- Florges at lvl 600 Volcanic (non-fire skills, clã=1) ----
console.log("\nFlorges Volcanic lvl 600 +50 XA5 (clã non-match = 1.0):");
const florgesBase = {
  playerLvl: 600,
  clan: "volcanic" as const,
  hunt: "400+" as const,
  mob: { name: "dummy", types: ["psychic" as const], hp: 0, defFactor: 1 },
  device: { kind: "x-attack" as const, tier: 0 as const },
  pokeSetups: { florges: { boost: 50, held: { kind: "x-attack" as const, tier: 5 as const }, hasDevice: false } },
  skillCalibrations: {},
};
const heartPound: Skill = { name: "Heart Pound", cooldown: 35, type: "area", cc: null, buff: null, element: "fairy", power: 14.50 };
const floralStorm: Skill = { name: "Floral Storm", cooldown: 55, type: "area", cc: null, buff: null, element: "fairy", power: 25.12 };
const petalBlizzard: Skill = { name: "Petal Blizzard", cooldown: 45, type: "area", cc: null, buff: null, element: "grass", power: 23.18 };
const grassyTerrain: Skill = { name: "Grassy Terrain", cooldown: 45, type: "area", cc: "stun", buff: null, element: "grass", power: 12.85 };

assert("Heart Pound", 14421, computeSkillDamage(florgesBase, florges, heartPound));
assert("Floral Storm", 24973, computeSkillDamage(florgesBase, florges, floralStorm));
assert("Petal Blizzard", 23050, computeSkillDamage(florgesBase, florges, petalBlizzard));
assert("Grassy Terrain", 12773, computeSkillDamage(florgesBase, florges, grassyTerrain));

// ---- Florges at lvl 369 Orebound (player lvl BASE, no NL bonus) ----
console.log("\nFlorges Orebound lvl 369 BASE +50 XA5 (player lvl = base, não efetivo):");
const florgesOrebound: DamageConfig = {
  ...florgesBase,
  playerLvl: 369,
  clan: "orebound",
};
assert("Petal Blizzard @ lvl 369", 16557, computeSkillDamage(florgesOrebound, florges, petalBlizzard));
assert("Floral Storm @ lvl 369", 17951, computeSkillDamage(florgesOrebound, florges, floralStorm));
assert("Grassy Terrain @ lvl 369", 9194, computeSkillDamage(florgesOrebound, florges, grassyTerrain));

// ---- Florges at lvl 369 Orebound + device X-Boost T7 ----
console.log("\nFlorges Orebound lvl 369 +50 XA5 + device X-Boost T7 (valida 2X rule):");
const florgesDevice: DamageConfig = {
  ...florgesOrebound,
  device: { kind: "x-boost", tier: 7 },
  pokeSetups: { florges: { boost: 50, held: { kind: "x-attack", tier: 5 }, hasDevice: true } },
};
assert("Petal Blizzard + X-Boost T7", 19128, computeSkillDamage(florgesDevice, florges, petalBlizzard));
assert("Heart Pound + X-Boost T7", 11974, computeSkillDamage(florgesDevice, florges, heartPound));
assert("Floral Storm + X-Boost T7", 20716, computeSkillDamage(florgesDevice, florges, floralStorm));
assert("Grassy Terrain + X-Boost T7", 10596, computeSkillDamage(florgesDevice, florges, grassyTerrain));

// ---- Sh.Heatmor Volcanic lvl 600 fire skills (clã MATCH = 1.28) ----
console.log("\nSh.Heatmor Volcanic lvl 600 XA8 (clã fire match = 1.28):");
const heatmorBase70: DamageConfig = {
  playerLvl: 600,
  clan: "volcanic",
  hunt: "400+",
  mob: { name: "dummy", types: ["psychic"], hp: 0, defFactor: 1 },
  device: { kind: "x-attack", tier: 0 },
  pokeSetups: { "shiny-heatmor": { boost: 70, held: { kind: "x-attack", tier: 8 }, hasDevice: false } },
  skillCalibrations: {},
};
const heatmorBase80: DamageConfig = {
  ...heatmorBase70,
  pokeSetups: { "shiny-heatmor": { boost: 80, held: { kind: "x-attack", tier: 8 }, hasDevice: false } },
};
const burningJealousy: Skill = { name: "Burning Jealousy", cooldown: 40, type: "area", cc: "stun", buff: null, element: "fire", power: 22.65 };
const shadowFire: Skill = { name: "Shadow Fire", cooldown: 50, type: "area", cc: null, buff: null, element: "fire", power: 24.20 };
const fireLash: Skill = { name: "Fire Lash", cooldown: 50, type: "area", cc: null, buff: null, element: "fire", power: 25.17 };

assert("Heatmor +70 BJ", 31949, computeSkillDamage(heatmorBase70, heatmor, burningJealousy));
assert("Heatmor +80 BJ", 32425, computeSkillDamage(heatmorBase80, heatmor, burningJealousy));
assert("Heatmor +80 Shadow Fire", 34675, computeSkillDamage(heatmorBase80, heatmor, shadowFire));
assert("Heatmor +80 Fire Lash", 36025, computeSkillDamage(heatmorBase80, heatmor, fireLash));

// ---- Ninetales Volcanic lvl 600 XA5 vs XA8 (valida X-Atk T5 + T8) ----
console.log("\nNinetales Volcanic lvl 600 +70 (XA5 vs XA8 → valida helds):");
const ninetalesXA8: DamageConfig = {
  playerLvl: 600,
  clan: "volcanic",
  hunt: "400+",
  mob: { name: "dummy", types: ["psychic"], hp: 0, defFactor: 1 },
  device: { kind: "x-attack", tier: 0 },
  pokeSetups: { ninetales: { boost: 70, held: { kind: "x-attack", tier: 8 }, hasDevice: false } },
  skillCalibrations: {},
};
const ninetalesXA5: DamageConfig = {
  ...ninetalesXA8,
  pokeSetups: { ninetales: { boost: 70, held: { kind: "x-attack", tier: 5 }, hasDevice: false } },
};
const ninetalesBJ: Skill = { name: "Burning Jealousy", cooldown: 40, type: "area", cc: "stun", buff: null, element: "fire", power: 22.47 };

assert("Ninetales XA8 BJ", 31697, computeSkillDamage(ninetalesXA8, ninetales, ninetalesBJ));
// Ninetales XA5 ball tinha food 1% → observado é 1.01× predito
const ninetalesXA5Predicted = computeSkillDamage(ninetalesXA5, ninetales, ninetalesBJ);
assert("Ninetales XA5 BJ (sem food bonus)", Math.round(29788 / 1.01), ninetalesXA5Predicted);

// ---- Summary ----
console.log(`\n=== Validation tests: ${failures === 0 ? "PASSED" : `${failures} FAILED`} ===`);
if (failures > 0) throw new Error(`${failures} assertion(s) failed`);
