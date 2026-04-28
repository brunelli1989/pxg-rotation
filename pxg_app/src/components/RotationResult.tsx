import type { Lure, RotationResult as RotationResultType } from "../types";
import { SkillBadge } from "./SkillBadge";
import { ELIXIR_PRICE, REVIVE_PRICE } from "../engine/cooldown";

interface Props {
  result: RotationResultType;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m${s.toString().padStart(2, "0")}s` : `${s}s`;
}

function countConsumablesPerCycle(result: RotationResultType) {
  let elixirAtk = 0, reviveNormal = 0, reviveSuperior = 0;
  for (const step of result.steps) {
    if (step.lure.usesElixirAtk) elixirAtk++;
    if (step.lure.reviveTier === "normal") reviveNormal++;
    if (step.lure.reviveTier === "superior") reviveSuperior++;
  }
  return { elixirAtk, reviveNormal, reviveSuperior };
}

function lureFinisherLabel(lure: Lure): string {
  if (lure.usesDevice) return "Device";
  if (lure.usesElixirAtk) return lure.type === "solo_elixir" ? "Swordsman Elixir" : "+ Swordsman Elixir";
  if (lure.type === "group") {
    const count = 2 + lure.extraMembers.length;
    return `Group (${count})`;
  }
  return "Dupla";
}

const FINISHER_STYLES: Record<string, string> = {
  device: "bg-warn/20 text-warn border-warn/35",
  elixir: "bg-danger/20 text-danger border-danger/35",
  dupla: "bg-success/20 text-success border-success/35",
  group: "bg-success/20 text-success border-success/35",
  revive: "bg-lure-purple-soft text-[#bb8fce] border-lure-purple-strong",
};

function lureFinisherKey(lure: Lure): keyof typeof FINISHER_STYLES {
  if (lure.usesDevice) return "device";
  if (lure.usesElixirAtk) return "elixir";
  if (lure.type === "group") return "group";
  return "dupla";
}

const TIER_STYLES: Record<string, string> = {
  T1A: "bg-[#ff6b9d] text-bg-app",
  T1B: "bg-[#ffa07a] text-bg-app",
  T1H: "bg-warn-strong text-bg-app",
  T1C: "bg-[#e8c872] text-bg-app",
  T2: "bg-[#c0c0c0] text-bg-app",
  T3: "bg-[#cd7f32] text-bg-app",
  TR: "bg-accent-blue text-white",
  TM: "bg-[#9b59b6] text-white",
};

const tierBadgeCls = (tier: string) =>
  `text-[0.7rem] font-bold px-1.5 py-px rounded-sm ${TIER_STYLES[tier] ?? "bg-text-dim text-bg-app"}`;
const finishBadgeCls = (key: string) =>
  `text-[0.7rem] font-semibold px-1.5 py-px rounded-sm border ${FINISHER_STYLES[key]}`;

export function RotationResultView({ result }: Props) {
  const c = countConsumablesPerCycle(result);
  const cyclePerHour = 3600 / result.totalTime;
  const elixirAtkPerHour = c.elixirAtk * cyclePerHour;
  const reviveNormalPerHour = c.reviveNormal * cyclePerHour;
  const reviveSuperiorPerHour = c.reviveSuperior * cyclePerHour;
  const totalCostPerHour =
    elixirAtkPerHour * ELIXIR_PRICE +
    reviveNormalPerHour * REVIVE_PRICE.normal +
    reviveSuperiorPerHour * REVIVE_PRICE.superior;
  const hasConsumables = c.elixirAtk + c.reviveNormal + c.reviveSuperior > 0;

  return (
    <section className="mt-6">
      <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
        <h2 className="m-0 text-[1.2rem] text-white">Rotação Ótima ({result.steps.length} lures por ciclo)</h2>
        <div className="flex gap-4 text-[0.85rem]">
          <span className="text-base px-3 py-1 bg-accent-blue/15 border border-accent-blue-soft rounded-md">
            Boxes/h: <strong className="text-accent-blue-light text-[1.2rem]">{Math.round((3600 * result.steps.length) / result.totalTime)}</strong>
          </span>
          <span className="text-base px-3 py-1 bg-accent-blue/15 border border-accent-blue-soft rounded-md">
            Pokémons/h: <strong className="text-accent-blue-light text-[1.2rem]">{Math.round((3600 * result.steps.length * 6) / result.totalTime)}</strong>
          </span>
          <span>Ciclo: <strong className="text-accent-blue">{formatTime(result.totalTime)}</strong></span>
          <span>Ocioso: <strong className="text-accent-blue">{formatTime(result.totalIdle)}</strong></span>
          {hasConsumables && (
            <span title="Custo total de consumíveis por hora">
              Consumíveis/h:{" "}
              {c.elixirAtk > 0 && <strong className="text-accent-blue">{elixirAtkPerHour.toFixed(1)} swordsman</strong>}
              {c.reviveNormal > 0 && <> {c.elixirAtk > 0 && "+ "}<strong className="text-accent-blue">{reviveNormalPerHour.toFixed(1)} revive</strong></>}
              {c.reviveSuperior > 0 && <> {(c.elixirAtk + c.reviveNormal) > 0 && "+ "}<strong className="text-accent-blue">{reviveSuperiorPerHour.toFixed(1)} revive+</strong></>}
              {" "}(<strong className="text-accent-blue">${Math.round(totalCostPerHour).toLocaleString()}/h</strong>)
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {result.steps.map((step, i) => {
          const lure = step.lure;
          const activeDuration = step.timeEnd - step.timeStart - step.idleBefore;
          return (
            <div key={i} className="flex gap-3 bg-bg-card rounded-lg p-3 border border-[#333]">
              <div className="text-[1.2rem] font-bold text-accent-blue min-w-[28px] flex items-center justify-center">{i + 1}</div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="font-semibold text-[0.95rem]">{lure.starter.name}</span>
                  <span className={tierBadgeCls(lure.starter.tier)}>{lure.starter.tier}</span>
                  {lure.second && (
                    <>
                      <span className="text-text-dim font-semibold px-0.5">+</span>
                      <span className="font-semibold text-[0.95rem]">{lure.second.name}</span>
                      <span className={tierBadgeCls(lure.second.tier)}>{lure.second.tier}</span>
                    </>
                  )}
                  {lure.extraMembers.map((m) => (
                    <span key={m.poke.id} className="contents">
                      <span className="text-text-dim font-semibold px-0.5">+</span>
                      <span className="font-semibold text-[0.95rem]">{m.poke.name}</span>
                      <span className={tierBadgeCls(m.poke.tier)}>{m.poke.tier}</span>
                    </span>
                  ))}
                  <span className={finishBadgeCls(lureFinisherKey(lure))}>{lureFinisherLabel(lure)}</span>
                  {lure.reviveTier && (() => {
                    const target =
                      lure.starter.id === lure.revivePokemonId ? lure.starter.name
                      : lure.second?.id === lure.revivePokemonId ? lure.second.name
                      : lure.extraMembers.find((m) => m.poke.id === lure.revivePokemonId)?.poke.name;
                    const label = lure.reviveTier === "superior" ? "🔄 Revive+" : "🔄 Revive";
                    return (
                      <span className={finishBadgeCls("revive")} title={`${target} casta o kit 2×`}>
                        {label} ({target})
                      </span>
                    );
                  })()}
                  {lure.starterUsesHarden && (
                    <span className="text-[0.65rem] font-semibold px-1.5 py-px rounded-sm border bg-[#3498db]/20 text-[#3498db] border-[#3498db]/35">
                      Harden
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-0.5 mb-1.5">
                  <span className="flex flex-wrap items-center gap-0.5 mr-2.5">
                    <span className="text-[0.7rem] text-text-dim font-semibold mr-1">{lure.starter.name}:</span>
                    {lure.starterSkills.map((skill, j) => (
                      <span key={skill.name} className="inline-flex items-center gap-0.5">
                        {j > 0 && <span className="text-[#555] text-[0.75rem] mx-0.5">→</span>}
                        <SkillBadge skill={skill} compact />
                      </span>
                    ))}
                  </span>
                  {lure.second && lure.secondSkills.length > 0 && (
                    <span className="flex flex-wrap items-center gap-0.5 mr-2.5">
                      <span className="text-[0.7rem] text-text-dim font-semibold mr-1">{lure.second.name}:</span>
                      {lure.secondSkills.map((skill, j) => (
                        <span key={skill.name} className="inline-flex items-center gap-0.5">
                          {j > 0 && <span className="text-[#555] text-[0.75rem] mx-0.5">→</span>}
                          <SkillBadge skill={skill} compact />
                        </span>
                      ))}
                    </span>
                  )}
                  {lure.extraMembers.map((m) => (
                    <span key={m.poke.id} className="flex flex-wrap items-center gap-0.5 mr-2.5">
                      <span className="text-[0.7rem] text-text-dim font-semibold mr-1">{m.poke.name}:</span>
                      {m.skills.map((skill, j) => (
                        <span key={skill.name} className="inline-flex items-center gap-0.5">
                          {j > 0 && <span className="text-[#555] text-[0.75rem] mx-0.5">→</span>}
                          <SkillBadge skill={skill} compact />
                        </span>
                      ))}
                    </span>
                  ))}
                </div>

                <div className="text-[0.75rem] text-text-dim flex gap-3">
                  <span>Duração: {formatTime(activeDuration)}</span>
                  {step.idleBefore > 0 && (
                    <span className="text-danger font-semibold">Espera: {formatTime(step.idleBefore)}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-center text-accent-blue font-semibold mt-3 p-2 border border-dashed border-accent-blue-soft rounded-md">
        ↩ Volta ao passo 1
      </div>
    </section>
  );
}
