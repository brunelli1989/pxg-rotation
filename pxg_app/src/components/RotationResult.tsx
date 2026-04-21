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
  if (lure.usesElixirAtk) return lure.type === "solo_elixir" ? "Elixir Atk" : "+ Elixir Atk";
  if (lure.type === "group") {
    const count = 2 + lure.extraMembers.length; // starter + second + extras
    return `Group (${count})`;
  }
  return "Dupla";
}

function lureFinisherClass(lure: Lure): string {
  if (lure.usesDevice) return "device";
  if (lure.usesElixirAtk) return "elixir";
  if (lure.type === "group") return "group";
  return "dupla";
}

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
    <section className="rotation-result">
      <div className="result-header">
        <h2>Rotação Ótima ({result.steps.length} lures por ciclo)</h2>
        <div className="result-stats">
          <span className="stat stat-primary">
            Boxes/h: <strong>{Math.round((3600 * result.steps.length) / result.totalTime)}</strong>
          </span>
          <span className="stat stat-primary">
            Pokémons/h: <strong>{Math.round((3600 * result.steps.length * 6) / result.totalTime)}</strong>
          </span>
          <span className="stat">
            Ciclo: <strong>{formatTime(result.totalTime)}</strong>
          </span>
          <span className="stat">
            Ocioso: <strong>{formatTime(result.totalIdle)}</strong>
          </span>
          {hasConsumables && (
            <span className="stat" title="Custo total de consumíveis por hora">
              Consumíveis/h:{" "}
              {c.elixirAtk > 0 && <strong>{elixirAtkPerHour.toFixed(1)} elixir</strong>}
              {c.reviveNormal > 0 && <> {c.elixirAtk > 0 && "+ "}<strong>{reviveNormalPerHour.toFixed(1)} revive</strong></>}
              {c.reviveSuperior > 0 && <> {(c.elixirAtk + c.reviveNormal) > 0 && "+ "}<strong>{reviveSuperiorPerHour.toFixed(1)} revive+</strong></>}
              {" "}(<strong>${Math.round(totalCostPerHour).toLocaleString()}/h</strong>)
            </span>
          )}
        </div>
      </div>

      <div className="rotation-steps">
        {result.steps.map((step, i) => {
          const lure = step.lure;
          const activeDuration = step.timeEnd - step.timeStart - step.idleBefore;
          return (
            <div key={i} className="rotation-step">
              <div className="step-number">{i + 1}</div>
              <div className="step-content">
                <div className="step-header">
                  <span className="step-pokemon">{lure.starter.name}</span>
                  <span className={`step-tier tier-${lure.starter.tier.toLowerCase()}`}>
                    {lure.starter.tier}
                  </span>
                  {lure.second && (
                    <>
                      <span className="step-plus">+</span>
                      <span className="step-pokemon">{lure.second.name}</span>
                      <span className={`step-tier tier-${lure.second.tier.toLowerCase()}`}>
                        {lure.second.tier}
                      </span>
                    </>
                  )}
                  {lure.extraMembers.map((m) => (
                    <span key={m.poke.id}>
                      <span className="step-plus">+</span>
                      <span className="step-pokemon">{m.poke.name}</span>
                      <span className={`step-tier tier-${m.poke.tier.toLowerCase()}`}>
                        {m.poke.tier}
                      </span>
                    </span>
                  ))}
                  <span className={`step-finish ${lureFinisherClass(lure)}`}>
                    {lureFinisherLabel(lure)}
                  </span>
                  {lure.reviveTier && (() => {
                    const target =
                      lure.starter.id === lure.revivePokemonId ? lure.starter.name
                      : lure.second?.id === lure.revivePokemonId ? lure.second.name
                      : lure.extraMembers.find((m) => m.poke.id === lure.revivePokemonId)?.poke.name;
                    const label = lure.reviveTier === "superior" ? "🔄 Revive+" : "🔄 Revive";
                    return (
                      <span className="step-finish revive" title={`${target} casta o kit 2×`}>
                        {label} ({target})
                      </span>
                    );
                  })()}
                  {lure.starterUsesHarden && (
                    <span className="step-defense harden">Harden</span>
                  )}
                </div>

                <div className="step-skills">
                  <span className="step-skills-group">
                    <span className="group-label">{lure.starter.name}:</span>
                    {lure.starterSkills.map((skill, j) => (
                      <span key={skill.name} className="step-skill-item">
                        {j > 0 && <span className="skill-arrow">→</span>}
                        <SkillBadge skill={skill} compact />
                      </span>
                    ))}
                  </span>
                  {lure.second && lure.secondSkills.length > 0 && (
                    <span className="step-skills-group">
                      <span className="group-label">{lure.second.name}:</span>
                      {lure.secondSkills.map((skill, j) => (
                        <span key={skill.name} className="step-skill-item">
                          {j > 0 && <span className="skill-arrow">→</span>}
                          <SkillBadge skill={skill} compact />
                        </span>
                      ))}
                    </span>
                  )}
                  {lure.extraMembers.map((m) => (
                    <span key={m.poke.id} className="step-skills-group">
                      <span className="group-label">{m.poke.name}:</span>
                      {m.skills.map((skill, j) => (
                        <span key={skill.name} className="step-skill-item">
                          {j > 0 && <span className="skill-arrow">→</span>}
                          <SkillBadge skill={skill} compact />
                        </span>
                      ))}
                    </span>
                  ))}
                </div>

                <div className="step-timing">
                  <span>Duração: {formatTime(activeDuration)}</span>
                  {step.idleBefore > 0 && (
                    <span className="idle-warning">
                      Espera: {formatTime(step.idleBefore)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rotation-loop">↩ Volta ao passo 1</div>
    </section>
  );
}
