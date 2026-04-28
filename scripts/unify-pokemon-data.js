#!/usr/bin/env node
// Unifica pokemon.json (skills calibradas) + pokemon_roster.json (catálogo) num só arquivo.
// Aplica também os dados do wiki (clans, roles PvE+PvP) extraídos de rebuild-roster.js.
// Output: novo pokemon.json com todos os pokes (calibrados ou não).

const fs = require("fs");
const path = require("path");

const POKEMON_PATH = path.join(__dirname, "..", "pxg_app", "src", "data", "pokemon.json");
const ROSTER_PATH = path.join(__dirname, "..", "pxg_app", "src", "data", "pokemon_roster.json");

// Reusa o wikiData do script rebuild-roster.js
const { wikiData, mapRole, TIER_RANK } = require("./wiki-data.js");

const PVE_ROLE_PRIORITY = ["otdd", "burst_dd", "offensive_tank", "tank", "speedster", "support", "disrupter"];
const PVP_ROLE_PRIORITY = ["otdd", "burst_dd", "offensive_tank", "tank", "speedster", "disrupter", "support"];

function pickRole(roles, priority) {
  if (roles.size === 0) return null;
  for (const r of priority) if (roles.has(r)) return r;
  return null;
}

function pickTier(tiers) {
  return tiers
    .map((t) => t.tier)
    .sort((a, b) => (TIER_RANK[a] ?? 99) - (TIER_RANK[b] ?? 99))[0];
}

function toId(name) {
  return name
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[\(\)]/g, "")
    .replace(/\./g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const pokemonRaw = JSON.parse(fs.readFileSync(POKEMON_PATH, "utf8"));
const rosterRaw = JSON.parse(fs.readFileSync(ROSTER_PATH, "utf8"));

// Index calibrado por id (pokemon.json é a fonte de skills/melee/wiki)
const calibratedById = new Map(pokemonRaw.map((p) => [p.id, p]));
// Index do roster por id (fonte canônica de elements)
const rosterById = new Map(rosterRaw.map((p) => [p.id, p]));
// Index do roster por name pra match com wiki
const rosterByName = new Map(rosterRaw.map((p) => [p.name, p]));

// Merge wiki: name → {tiers per clan, pveRoles, pvpRoles, clans set}
const wikiMerged = new Map();
for (const [clanName, entries] of Object.entries(wikiData)) {
  for (const entry of entries) {
    let m = wikiMerged.get(entry.name);
    if (!m) {
      m = {
        name: entry.name,
        clans: new Set(),
        tiers: [],
        pveRoles: new Set(),
        pvpRoles: new Set(),
      };
      wikiMerged.set(entry.name, m);
    }
    m.clans.add(clanName);
    m.tiers.push({ clan: clanName, tier: entry.tier });
    const pveR = mapRole(entry.pve);
    const pvpR = mapRole(entry.pvp);
    if (pveR) m.pveRoles.add(pveR);
    if (pvpR) m.pvpRoles.add(pvpR);
  }
}

const unified = [];
const seenIds = new Set();

// 1. Para cada poke do wiki, cria entry merged (priorizando calibrated)
for (const m of wikiMerged.values()) {
  const rosterEntry = rosterByName.get(m.name);
  const id = rosterEntry?.id ?? toId(m.name);
  if (seenIds.has(id)) {
    console.warn(`Duplicate id from wiki: ${id} (${m.name}) — skipping`);
    continue;
  }
  seenIds.add(id);

  const calibrated = calibratedById.get(id);
  const tier = calibrated?.tier ?? pickTier(m.tiers);
  const role = pickRole(m.pveRoles, PVE_ROLE_PRIORITY) ?? calibrated?.role ?? "burst_dd";
  const pvpRole = pickRole(m.pvpRoles, PVP_ROLE_PRIORITY);
  const elements = rosterEntry?.elements ?? calibrated?.elements ?? [];

  const entry = {
    id,
    name: m.name,
    tier,
    clans: [...m.clans].sort(),
    role,
    pvpRole: pvpRole ?? null,
    elements,
  };
  // Anexa campos calibrados se existem
  if (calibrated?.wiki) entry.wiki = calibrated.wiki;
  if (calibrated?.todo) entry.todo = calibrated.todo;
  if (calibrated?.observacao) entry.observacao = calibrated.observacao;
  if (calibrated?.config) entry.config = calibrated.config;
  entry.skills = calibrated?.skills ?? [];
  if (calibrated?.melee) entry.melee = calibrated.melee;

  unified.push(entry);
}

// 2. Pokes existentes em pokemon.json/roster mas NÃO no wiki — manter
for (const p of pokemonRaw) {
  if (seenIds.has(p.id)) continue;
  seenIds.add(p.id);
  const rosterEntry = rosterById.get(p.id);
  const entry = { ...p };
  if (rosterEntry?.clans && !entry.clans) entry.clans = rosterEntry.clans;
  if (rosterEntry?.elements && (!entry.elements || entry.elements.length === 0)) {
    entry.elements = rosterEntry.elements;
  }
  if (rosterEntry?.role && !entry.role) entry.role = rosterEntry.role;
  if (!entry.skills) entry.skills = [];
  unified.push(entry);
}
for (const r of rosterRaw) {
  if (seenIds.has(r.id)) continue;
  seenIds.add(r.id);
  unified.push({
    id: r.id,
    name: r.name,
    tier: r.tier,
    clans: r.clans ?? [],
    role: r.role,
    pvpRole: r.pvpRole ?? null,
    elements: r.elements ?? [],
    skills: [],
  });
}

unified.sort((a, b) => a.name.localeCompare(b.name));

fs.writeFileSync(POKEMON_PATH, JSON.stringify(unified, null, 2) + "\n");
console.log(`Wrote ${unified.length} entries to unified pokemon.json`);
console.log(`Calibrated (with skills): ${unified.filter((p) => p.skills.length > 0).length}`);
console.log(`Roles by PvE:`);
for (const r of PVE_ROLE_PRIORITY.concat(["null"])) {
  const count = unified.filter((p) => (p.role ?? "null") === r).length;
  if (count > 0) console.log(`  ${r}: ${count}`);
}
console.log(`Without elements: ${unified.filter((p) => !p.elements || p.elements.length === 0).length}`);
