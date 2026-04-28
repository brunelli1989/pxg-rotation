import type { RotationResult } from "../types";

interface Props {
  result: RotationResult;
}

const POKEMON_COLORS = [
  "#e74c3c",
  "#3498db",
  "#2ecc71",
  "#f39c12",
  "#9b59b6",
  "#1abc9c",
  "#e67e22",
  "#34495e",
];

const idleStripes = "repeating-linear-gradient(45deg, #1a1a2e, #1a1a2e 4px, #222 4px, #222 8px)";

export function SkillTimeline({ result }: Props) {
  const totalTime = result.totalTime;
  if (totalTime === 0) return null;

  return (
    <section className="mt-6">
      <h3 className="text-[0.95rem] text-[#ccc] m-0 mb-2">Timeline</h3>
      <div className="flex h-9 rounded-md overflow-hidden bg-bg-card border border-[#333]">
        {result.steps.map((step, i) => {
          const lure = step.lure;
          const activeTime = step.timeEnd - step.timeStart - step.idleBefore;
          const activeWidth = (activeTime / totalTime) * 100;
          const idleWidth = (step.idleBefore / totalTime) * 100;
          const shortName = (p: { name: string }) => p.name.split(" ").pop();
          const parts = [lure.starter, lure.second, ...lure.extraMembers.map((m) => m.poke)]
            .filter((p): p is NonNullable<typeof p> => p !== null);
          const label = parts.map(shortName).join("+");

          return (
            <span key={i} className="contents">
              {step.idleBefore > 0 && (
                <span
                  className="flex items-center justify-center text-[0.6rem] text-text-dim min-w-[2px]"
                  style={{ width: `${idleWidth}%`, background: idleStripes }}
                  title={`Espera: ${Math.round(step.idleBefore)}s`}
                >
                  {Math.round(step.idleBefore)}s
                </span>
              )}
              <span
                className="flex items-center justify-center text-[0.65rem] font-semibold text-white overflow-hidden whitespace-nowrap min-w-[2px] [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]"
                style={{
                  width: `${activeWidth}%`,
                  backgroundColor: POKEMON_COLORS[i % POKEMON_COLORS.length],
                }}
                title={`${label}: ${Math.round(activeTime)}s`}
              >
                {label}
              </span>
            </span>
          );
        })}
      </div>
      <div className="flex justify-between text-[0.7rem] text-[#666] mt-1">
        <span>0s</span>
        <span>{Math.round(totalTime / 2)}s</span>
        <span>{Math.round(totalTime)}s</span>
      </div>
    </section>
  );
}
