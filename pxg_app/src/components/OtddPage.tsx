import { useEffect, useMemo, useState } from "react";
import type { Boss, BossCategory, DamageConfig, Pokemon, PokemonElement, XAtkTier } from "../types";
import pokemonData from "../data/pokemon.json";
import bossesData from "../data/bosses.json";
import { computeSkillDamage, resolveSkillPower } from "../engine/damage";

const bosses = bossesData as Boss[];
const BOSS_CATEGORIES: BossCategory[] = ["Nightmare Terror", "Bestas Lendárias"];

const allPokes: Pokemon[] = pokemonData as Pokemon[];

const SIM_DURATION = 600; // 10 min em segundos
const CAST_TIME = 1; // 1s por cast

const HELDS_STORAGE_KEY = "pxg_otdd_helds";

interface PokeHeld {
  boost: number;
  xAtkTier: XAtkTier;
  xBoostTier: XAtkTier;
}

const DEFAULT_HELD: PokeHeld = { boost: 70, xAtkTier: 8, xBoostTier: 0 };

function loadHelds(): Record<string, PokeHeld> {
  try {
    const raw = localStorage.getItem(HELDS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

interface PokeRow {
  poke: Pokemon;
  held: PokeHeld;
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
  held: PokeHeld,
  pokeId: string,
  targetTypes: PokemonElement[]
): DamageConfig {
  return {
    playerLvl,
    clan: null,
    hunt: "300",
    mob: { name: "target", types: targetTypes, hp: 0, defFactor: 1 },
    device: held.xBoostTier > 0 ? { kind: "x-boost", tier: held.xBoostTier } : { kind: "x-attack", tier: 0 },
    pokeSetups: {
      [pokeId]: {
        boost: held.boost,
        held: { kind: "x-attack", tier: held.xAtkTier },
        hasDevice: held.xBoostTier > 0,
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
    let bestIdx = -1;
    for (let i = 0; i < skillData.length; i++) {
      if (cooldowns[i] <= t) {
        bestIdx = i;
        break;
      }
    }

    if (bestIdx === -1) {
      const nextReady = Math.min(...cooldowns.filter((c) => c > t));
      t = nextReady;
      continue;
    }

    const { skill, dano } = skillData[bestIdx];
    casts[bestIdx]++;
    dmgs[bestIdx] += dano;
    totalDmg += dano;
    totalCasts++;

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
  const [bossId, setBossId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [helds, setHelds] = useState<Record<string, PokeHeld>>(loadHelds);

  useEffect(() => {
    localStorage.setItem(HELDS_STORAGE_KEY, JSON.stringify(helds));
  }, [helds]);

  const updateHeld = (pokeId: string, patch: Partial<PokeHeld>) => {
    setHelds((prev) => ({
      ...prev,
      [pokeId]: { ...DEFAULT_HELD, ...prev[pokeId], ...patch },
    }));
  };

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

      const held = helds[poke.id] ?? DEFAULT_HELD;
      const cfg = buildConfig(playerLvl, held, poke.id, targetTypes);
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
        held,
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
  }, [playerLvl, helds, selectedBoss]);

  const filtered = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) => r.poke.name.toLowerCase().includes(q));
  }, [rows, search]);

  const fmt = (n: number) => Math.round(n).toLocaleString();

  const rowGrid = "grid grid-cols-[2fr_0.4fr_0.7fr_1fr_0.8fr_1fr] gap-2 items-center px-3 py-2 text-[0.875rem]";
  const skillRowGrid = "grid grid-cols-[2fr_0.8fr_0.5fr_0.7fr_1fr_1fr] gap-2 py-1 text-[0.825rem] text-[#c0c0c0]";
  const dpsCls = "text-right text-accent font-semibold tabular-nums";
  const heldInputCls = "px-1.5 py-0.5 text-[0.82rem] bg-bg-darker text-text border border-border-default rounded w-[60px]";
  const heldSelectCls = "px-1.5 py-0.5 text-[0.82rem] bg-bg-darker text-text border border-border-default rounded";

  return (
    <div className="py-4">
      <h2 className="text-2xl font-bold text-text m-0 mb-2">OTDD — Dano em 10 min</h2>
      <p className="text-text-dim text-[0.85rem] mb-5 italic leading-relaxed">
        Simulação greedy de 600s (casta a skill com maior dano sempre que ready).
        Selecione o boss pra aplicar efetividade (PxG piecewise). Cada poke tem seu próprio
        held (X-Atk/X-Boost/boost) salvo no navegador. Bônus de clã NÃO se aplica em boss fight.
        Buffs (Rage ×2/20s) ainda não modelados — valores são baseline sem buff.
      </p>

      <div className="flex flex-wrap gap-3 bg-bg-card px-4 py-3.5 rounded-lg mb-4">
        <label className="flex flex-col gap-1 text-[0.8rem] text-text-muted">
          Player lvl
          <input
            type="number"
            value={playerLvl}
            onChange={(e) => setPlayerLvl(Number(e.target.value) || 0)}
            min={1}
            max={1000}
            className="bg-bg-skills text-text border border-[#444] px-2 py-1.5 rounded-md text-[0.875rem] w-[80px]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[0.8rem] text-text-muted">
          Boss
          <select
            value={bossId}
            onChange={(e) => setBossId(e.target.value)}
            className="bg-bg-skills text-text border border-[#444] px-2 py-1.5 rounded-md text-[0.875rem] min-w-[100px]"
          >
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
        className="w-full bg-bg-skills text-text border border-[#444] px-3 py-2 rounded-md text-[0.9rem] mb-3 box-border"
        placeholder="Buscar poke..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="flex flex-col gap-1">
        <div className={`${rowGrid} bg-bg-darker rounded-md font-semibold text-text-dim text-[0.78rem] uppercase tracking-wider`}>
          <span>Poke</span>
          <span>Tier</span>
          <span>Held</span>
          <span>Melee/10m</span>
          <span>Skills/10m</span>
          <span className={dpsCls}>Total/10m</span>
        </div>
        {filtered.map((row) => {
          const expanded = expandedId === row.poke.id;
          const heldSummary = row.held.xBoostTier > 0
            ? `+${row.held.boost} XB${row.held.xBoostTier}`
            : `+${row.held.boost} XA${row.held.xAtkTier}`;
          return (
            <div
              key={row.poke.id}
              className="bg-bg-card rounded-md border border-transparent transition-[border-color] duration-150 hover:border-border-default"
            >
              <div
                className={`${rowGrid} cursor-pointer select-none ${expanded ? "bg-bg-card-hover rounded-t-md rounded-b-none" : ""}`}
                onClick={() => setExpandedId(expanded ? null : row.poke.id)}
              >
                <span className="font-medium text-text">{row.poke.name}</span>
                <span className="text-[0.75rem] text-text-dim">{row.poke.tier}</span>
                <span className="text-[0.78rem] text-text-muted tabular-nums">{heldSummary}</span>
                <span className={!row.meleeIncludedInTotal && row.meleeDmg > 0 ? "italic text-text-dim" : ""}>
                  {row.meleeDmg > 0 ? `${fmt(row.meleeDmg)}${!row.meleeIncludedInTotal ? " (close — não soma)" : ""}` : "—"}
                </span>
                <span>{fmt(row.skillsDmg)}</span>
                <span className={dpsCls}>{fmt(row.totalDmg)}</span>
              </div>
              {expanded && (
                <div className="bg-bg-skills rounded-b-md px-3 py-2">
                  <div
                    className="flex gap-3 items-center px-1 py-2 mb-1.5 border-b border-border-default flex-wrap"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <label className="flex items-center gap-1.5 text-[0.78rem] text-text-muted">
                      Boost
                      <input
                        type="number"
                        value={row.held.boost}
                        onChange={(e) => updateHeld(row.poke.id, { boost: Number(e.target.value) || 0 })}
                        min={0}
                        max={150}
                        className={heldInputCls}
                      />
                    </label>
                    <label className="flex items-center gap-1.5 text-[0.78rem] text-text-muted">
                      X-Atk
                      <select
                        value={row.held.xAtkTier}
                        onChange={(e) => updateHeld(row.poke.id, { xAtkTier: Number(e.target.value) as XAtkTier })}
                        className={heldSelectCls}
                      >
                        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((t) => (
                          <option key={t} value={t}>{t === 0 ? "—" : `T${t}`}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5 text-[0.78rem] text-text-muted">
                      X-Boost (device)
                      <select
                        value={row.held.xBoostTier}
                        onChange={(e) => updateHeld(row.poke.id, { xBoostTier: Number(e.target.value) as XAtkTier })}
                        className={heldSelectCls}
                      >
                        <option value={0}>Sem device</option>
                        {[1, 2, 3, 4, 5, 6, 7].map((t) => (
                          <option key={t} value={t}>T{t}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className={`${skillRowGrid} text-[0.72rem] text-[#777] uppercase tracking-wide border-b border-border-default pb-1.5 mb-1`}>
                    <span>Skill</span>
                    <span>Element</span>
                    <span>CD</span>
                    <span>Dano/cast</span>
                    <span>Casts</span>
                    <span className={dpsCls}>Total</span>
                  </div>
                  {row.poke.melee && row.meleeDmg > 0 && (
                    <div className={`${skillRowGrid} bg-bg-melee my-1 px-2 py-1 rounded border-l-[3px] border-accent`}>
                      <span>{row.poke.melee.kind === "ranged" ? "Auto-attack (ranged)" : "Auto-attack (close)"}</span>
                      <span>{row.poke.melee.element ?? "—"}</span>
                      <span>{row.poke.melee.attackInterval}s</span>
                      <span>{fmt(row.meleeDmg / row.meleeHits)}</span>
                      <span>{row.meleeHits}</span>
                      <span className={dpsCls}>{fmt(row.meleeDmg)}{!row.meleeIncludedInTotal ? " ⚠" : ""}</span>
                    </div>
                  )}
                  {row.skillRows
                    .slice()
                    .sort((a, b) => b.totalDmg - a.totalDmg)
                    .map((sr) => (
                      <div key={sr.name}>
                        <div className={skillRowGrid}>
                          <span>{sr.name}{sr.playerNote ? " ⚠" : ""}</span>
                          <span>{sr.element}</span>
                          <span>{sr.cooldown}s</span>
                          <span>{fmt(sr.danoPerCast)}</span>
                          <span>{sr.casts}</span>
                          <span className={dpsCls}>{fmt(sr.totalDmg)}</span>
                        </div>
                        {sr.playerNote && (
                          <div className="text-[0.75rem] text-accent px-3 py-0.5 italic">{sr.playerNote}</div>
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
