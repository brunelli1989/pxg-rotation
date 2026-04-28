import { useMemo, useState } from "react";
import type { Boss, BossCategory, DamageConfig, Pokemon, PokemonElement, XAtkTier } from "../types";
import pokemonData from "../data/pokemon.json";
import bossesData from "../data/bosses.json";
import { computeSkillDamage, resolveSkillPower } from "../engine/damage";

const bosses = bossesData as Boss[];
const BOSS_CATEGORIES: BossCategory[] = ["Nightmare Terror", "Bestas Lendárias"];

const allPokes: Pokemon[] = pokemonData as Pokemon[];

const SIM_DURATION = 600; // 10 min em segundos
const CAST_TIME = 1; // 1s por cast

interface PokeRow {
  poke: Pokemon;
  totalDmg: number;
  meleeDmg: number;
  meleeIncludedInTotal: boolean;
  skillsDmg: number;
  totalCasts: number;
  meleeHits: number;
  skillRows: SkillRow[];
}

interface SkillRow {
  name: string;
  element: string;
  cooldown: number;
  power: number;
  danoPerCast: number;
  casts: number;
  totalDmg: number;
  playerNote?: string;
}

/**
 * Boss fights não aplicam bônus de clã, então clan é forçado a null.
 * targetTypes define o(s) elemento(s) do alvo — engine aplica eff (PxG piecewise).
 * defFactor = 1 (boss já tem stats próprios, eff cobre matchup).
 */
function buildConfig(
  playerLvl: number,
  xAtkTier: XAtkTier,
  xBoostTier: XAtkTier,
  boost: number,
  pokeId: string,
  targetTypes: PokemonElement[]
): DamageConfig {
  return {
    playerLvl,
    clan: null,
    hunt: "300",
    mob: { name: "target", types: targetTypes, hp: 0, defFactor: 1 },
    device: xBoostTier > 0 ? { kind: "x-boost", tier: xBoostTier } : { kind: "x-attack", tier: 0 },
    pokeSetups: {
      [pokeId]: {
        boost,
        held: { kind: "x-attack", tier: xAtkTier },
        hasDevice: xBoostTier > 0,
      },
    },
    skillCalibrations: {},
  };
}

/**
 * Simula 600s (10 min) de casting greedy:
 * - A cada segundo, casta a skill com maior dano disponível (fora do CD)
 * - CD começa após o cast (clock + cd + cast_time)
 * - Sem buff modeling por enquanto (Rage ×2/20s não aplicado — futuro)
 */
function simulate10min(
  poke: Pokemon,
  cfg: DamageConfig
): { totalDmg: number; totalCasts: number; perSkill: Map<string, { casts: number; dmg: number }> } {
  const damageSkills = poke.skills.filter((s) => (resolveSkillPower(s, poke) ?? 0) > 0);
  if (damageSkills.length === 0) {
    return { totalDmg: 0, totalCasts: 0, perSkill: new Map() };
  }

  // Pré-computa dano por cast de cada skill
  const skillData = damageSkills.map((skill) => {
    const power = resolveSkillPower(skill, poke);
    const dano = computeSkillDamage(cfg, poke, skill, cfg.mob, { skillPower: power });
    return { skill, dano };
  });

  // Ordena por dano descendente — greedy prefere maior dano
  skillData.sort((a, b) => b.dano - a.dano);

  const cooldowns = new Array<number>(skillData.length).fill(0); // ready at t=0
  const casts = new Array<number>(skillData.length).fill(0);
  const dmgs = new Array<number>(skillData.length).fill(0);

  let t = 0;
  let totalDmg = 0;
  let totalCasts = 0;

  while (t < SIM_DURATION) {
    // Procura skill com maior dano que está ready
    let bestIdx = -1;
    for (let i = 0; i < skillData.length; i++) {
      if (cooldowns[i] <= t) {
        bestIdx = i;
        break; // skillData já está ordenado por dano descendente
      }
    }

    if (bestIdx === -1) {
      // Nenhuma skill ready — avança até a próxima ficar pronta
      const nextReady = Math.min(...cooldowns.filter((c) => c > t));
      t = nextReady;
      continue;
    }

    const { skill, dano } = skillData[bestIdx];
    casts[bestIdx]++;
    dmgs[bestIdx] += dano;
    totalDmg += dano;
    totalCasts++;

    // CD começa do início do cast
    cooldowns[bestIdx] = t + skill.cooldown;
    t += CAST_TIME;
  }

  const perSkill = new Map<string, { casts: number; dmg: number }>();
  skillData.forEach((sd, i) => {
    perSkill.set(sd.skill.name, { casts: casts[i], dmg: dmgs[i] });
  });

  return { totalDmg, totalCasts, perSkill };
}

export function OtddPage() {
  const [playerLvl, setPlayerLvl] = useState(600);
  const [xAtkTier, setXAtkTier] = useState<XAtkTier>(8);
  const [xBoostTier, setXBoostTier] = useState<XAtkTier>(0);
  const [boost, setBoost] = useState(70);
  const [bossId, setBossId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const selectedBoss = useMemo(() => bosses.find((b) => b.id === bossId), [bossId]);
  const bossesByCategory = useMemo(() => {
    const map = new Map<BossCategory, Boss[]>();
    for (const b of bosses) {
      if (!map.has(b.category)) map.set(b.category, []);
      map.get(b.category)!.push(b);
    }
    return map;
  }, []);

  const rows = useMemo<PokeRow[]>(() => {
    const result: PokeRow[] = [];
    const targetTypes: PokemonElement[] = selectedBoss?.types ?? [];

    for (const poke of allPokes) {
      if (poke.role !== "otdd") continue;
      const damageSkills = poke.skills.filter((s) => (resolveSkillPower(s, poke) ?? 0) > 0);

      const cfg = buildConfig(playerLvl, xAtkTier, xBoostTier, boost, poke.id, targetTypes);
      const sim = simulate10min(poke, cfg);

      const skillRows: SkillRow[] = damageSkills.map((skill) => {
        const power = resolveSkillPower(skill, poke);
        const danoPerCast = computeSkillDamage(cfg, poke, skill, cfg.mob, { skillPower: power });
        const stats = sim.perSkill.get(skill.name) ?? { casts: 0, dmg: 0 };
        return {
          name: skill.name,
          element: skill.element ?? "—",
          cooldown: skill.cooldown,
          power,
          danoPerCast,
          casts: stats.casts,
          totalDmg: stats.dmg,
          playerNote: skill.playerNote,
        };
      });

      // Auto-attack runs in parallel with casts. Hits/10min = floor(600/interval).
      // Included in OTDD total ONLY if ranged (TM): close melee does not count because
      // player is not adjacent to boss in real fights.
      let meleeHits = 0;
      let meleeDmg = 0;
      let meleeIncludedInTotal = false;
      if (poke.melee && poke.melee.attackInterval > 0) {
        meleeHits = Math.floor(SIM_DURATION / poke.melee.attackInterval);
        const meleeSkill = {
          name: "Auto-attack",
          cooldown: poke.melee.attackInterval,
          type: "target" as const,
          cc: null,
          buff: null,
          element: poke.melee.element,
          power: poke.melee.power,
        };
        const meleeDmgPerHit = computeSkillDamage(cfg, poke, meleeSkill, cfg.mob, { skillPower: poke.melee.power });
        meleeDmg = meleeDmgPerHit * meleeHits;
        meleeIncludedInTotal = poke.melee.kind === "ranged";
      }

      result.push({
        poke,
        totalDmg: sim.totalDmg + (meleeIncludedInTotal ? meleeDmg : 0),
        meleeDmg,
        meleeIncludedInTotal,
        skillsDmg: sim.totalDmg,
        totalCasts: sim.totalCasts,
        meleeHits,
        skillRows,
      });
    }

    result.sort((a, b) => b.totalDmg - a.totalDmg);
    return result;
  }, [playerLvl, xAtkTier, xBoostTier, boost, selectedBoss]);

  const filtered = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) => r.poke.name.toLowerCase().includes(q));
  }, [rows, search]);

  const fmt = (n: number) => Math.round(n).toLocaleString();

  return (
    <div className="otdd-page">
      <h2>OTDD — Dano em 10 min</h2>
      <p className="otdd-hint">
        Simulação greedy de 600s (casta a skill com maior dano sempre que ready).
        Selecione tipo(s) do target pra aplicar efetividade (PxG piecewise).
        Bônus de clã NÃO se aplica em boss fight. Buffs (Rage ×2/20s) ainda não modelados —
        valores são baseline sem buff.
      </p>

      <div className="otdd-config">
        <label>
          Player lvl
          <input
            type="number"
            value={playerLvl}
            onChange={(e) => setPlayerLvl(Number(e.target.value) || 0)}
            min={1}
            max={1000}
          />
        </label>
        <label>
          Boost
          <input
            type="number"
            value={boost}
            onChange={(e) => setBoost(Number(e.target.value) || 0)}
            min={0}
            max={150}
          />
        </label>
        <label>
          X-Atk Tier
          <select value={xAtkTier} onChange={(e) => setXAtkTier(Number(e.target.value) as XAtkTier)}>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((t) => (
              <option key={t} value={t}>
                T{t}
              </option>
            ))}
          </select>
        </label>
        <label>
          X-Boost Device
          <select value={xBoostTier} onChange={(e) => setXBoostTier(Number(e.target.value) as XAtkTier)}>
            <option value={0}>Sem device</option>
            {[1, 2, 3, 4, 5, 6, 7].map((t) => (
              <option key={t} value={t}>
                T{t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Boss
          <select value={bossId} onChange={(e) => setBossId(e.target.value)}>
            <option value="">Neutro (sem boss)</option>
            {BOSS_CATEGORIES.map((cat) => (
              <optgroup key={cat} label={cat}>
                {(bossesByCategory.get(cat) ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}{b.types.length > 0 ? ` (${b.types.join("/")})` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>

      <input
        type="text"
        className="otdd-search"
        placeholder="Buscar poke..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="otdd-list">
        <div className="otdd-row otdd-header-row">
          <span>Poke</span>
          <span>Tier</span>
          <span>Melee/10m</span>
          <span>Skills/10m</span>
          <span className="dps-col">Total/10m</span>
        </div>
        {filtered.map((row) => {
          const expanded = expandedId === row.poke.id;
          return (
            <div key={row.poke.id} className="otdd-poke">
              <div
                className={`otdd-row otdd-poke-row ${expanded ? "expanded" : ""}`}
                onClick={() => setExpandedId(expanded ? null : row.poke.id)}
              >
                <span className="poke-name">{row.poke.name}</span>
                <span className="poke-tier">{row.poke.tier}</span>
                <span className={!row.meleeIncludedInTotal && row.meleeDmg > 0 ? "melee-excluded" : ""}>
                  {row.meleeDmg > 0 ? `${fmt(row.meleeDmg)}${!row.meleeIncludedInTotal ? " (close — não soma)" : ""}` : "—"}
                </span>
                <span>{fmt(row.skillsDmg)}</span>
                <span className="dps-col">{fmt(row.totalDmg)}</span>
              </div>
              {expanded && (
                <div className="otdd-skills">
                  <div className="otdd-skill-row otdd-skill-header">
                    <span>Skill</span>
                    <span>Element</span>
                    <span>CD</span>
                    <span>Dano/cast</span>
                    <span>Casts</span>
                    <span className="dps-col">Total</span>
                  </div>
                  {row.poke.melee && row.meleeDmg > 0 && (
                    <div className={`otdd-skill-row otdd-melee-row ${!row.meleeIncludedInTotal ? "otdd-melee-excluded" : ""}`}>
                      <span>{row.poke.melee.kind === "ranged" ? "Auto-attack (ranged)" : "Auto-attack (close)"}</span>
                      <span>{row.poke.melee.element ?? "—"}</span>
                      <span>{row.poke.melee.attackInterval}s</span>
                      <span>{fmt(row.meleeDmg / row.meleeHits)}</span>
                      <span>{row.meleeHits}</span>
                      <span className="dps-col">{fmt(row.meleeDmg)}{!row.meleeIncludedInTotal ? " ⚠" : ""}</span>
                    </div>
                  )}
                  {row.skillRows
                    .slice()
                    .sort((a, b) => b.totalDmg - a.totalDmg)
                    .map((sr) => (
                      <div key={sr.name}>
                        <div className="otdd-skill-row">
                          <span>{sr.name}{sr.playerNote ? " ⚠" : ""}</span>
                          <span>{sr.element}</span>
                          <span>{sr.cooldown}s</span>
                          <span>{fmt(sr.danoPerCast)}</span>
                          <span>{sr.casts}</span>
                          <span className="dps-col">{fmt(sr.totalDmg)}</span>
                        </div>
                        {sr.playerNote && (
                          <div className="otdd-player-note">{sr.playerNote}</div>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
