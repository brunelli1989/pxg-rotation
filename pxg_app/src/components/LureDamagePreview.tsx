import { useMemo } from "react";
import type { DamageConfig, RotationResult } from "../types";
import { estimateLureDamagePerMob, lureFinalizesBox } from "../engine/damage";

interface Props {
  result: RotationResult;
  config: DamageConfig;
}

const thCls = "text-left px-2 py-1.5 text-text-dim font-medium border-b border-[#333]";
const tdCls = "px-2 py-1.5 border-b border-[#222]";

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
    <section className="bg-bg-card border border-[#333] rounded-lg p-4 mt-4">
      <h2 className="m-0 mb-3 text-base text-[#ccc]">
        Dano por Lure (vs {effectiveConfig.mob.name} [{effectiveConfig.mob.types.join("/")}] HP {effectiveConfig.mob.hp.toLocaleString()})
      </h2>
      <table className="w-full border-collapse text-[0.85rem]">
        <thead>
          <tr>
            <th className={thCls}>#</th>
            <th className={thCls}>Pokes</th>
            <th className={thCls}>Dano/mob (estimado)</th>
            <th className={thCls}>% HP</th>
            <th className={thCls}>Finaliza?</th>
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
            const rowClr = finalizes ? "text-[#7fd87f]" : "text-[#d87f7f]";

            return (
              <tr key={i} className={rowClr}>
                <td className={tdCls}>{i + 1}</td>
                <td className={tdCls}>{pokes}</td>
                <td className={tdCls}>{Math.round(dmg).toLocaleString()}</td>
                <td className={tdCls}>{pct.toFixed(1)}%</td>
                <td className={tdCls}>{finalizes ? "✓" : "✗"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
