import { useMemo } from "react";
import type { DamageConfig, RotationResult } from "../types";
import { estimateLureDamagePerMob, lureFinalizesBox } from "../engine/damage";

interface Props {
  result: RotationResult;
  config: DamageConfig;
}

export function LureDamagePreview({ result, config }: Props) {
  // Engine aplica override hasDevice=true no device holder. Espelhamos isso aqui
  // pro dano mostrado bater com o que o engine usou pra decidir a rotação.
  const effectiveConfig = useMemo(() => {
    if (!result.devicePokemonId) return config;
    const baseSetup = config.pokeSetups[result.devicePokemonId];
    if (!baseSetup || baseSetup.hasDevice) return config;
    return {
      ...config,
      pokeSetups: {
        ...config.pokeSetups,
        [result.devicePokemonId]: { ...baseSetup, hasDevice: true },
      },
    };
  }, [config, result.devicePokemonId]);

  return (
    <section className="lure-damage">
      <h2>
        Dano por Lure (vs {effectiveConfig.mob.name} [{effectiveConfig.mob.types.join("/")}] HP {effectiveConfig.mob.hp.toLocaleString()})
      </h2>
      <table className="lure-damage-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Pokes</th>
            <th>Dano/mob (estimado)</th>
            <th>% HP</th>
            <th>Finaliza?</th>
          </tr>
        </thead>
        <tbody>
          {result.steps.map((step, i) => {
            const dmg = estimateLureDamagePerMob(step.lure, effectiveConfig);
            const pct = (dmg / effectiveConfig.mob.hp) * 100;
            const finalizes = lureFinalizesBox(step.lure, effectiveConfig);
            const pokes = [
              step.lure.starter.name,
              step.lure.second?.name,
              ...step.lure.extraMembers.map((m) => m.poke.name),
            ]
              .filter(Boolean)
              .join(" + ");

            return (
              <tr key={i} className={finalizes ? "finalizes" : "not-finalizes"}>
                <td>{i + 1}</td>
                <td>{pokes}</td>
                <td>{Math.round(dmg).toLocaleString()}</td>
                <td>{pct.toFixed(1)}%</td>
                <td>{finalizes ? "✓" : "✗"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
