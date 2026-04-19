import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DamageConfig, DiskLevel, Pokemon, RotationResult } from "../types";
import { findOptimalRotationAsync } from "../engine/rotationAsync";

export interface RotationState {
  result: RotationResult | null;
  loading: boolean;
  progress: { done: number; total: number };
  cancel: () => void;
}

export function useRotation(
  allPokemon: Pokemon[],
  selectedIds: string[],
  diskLevel: DiskLevel,
  enabled: boolean,
  damageConfig?: DamageConfig
): RotationState {
  const [result, setResult] = useState<RotationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const abortRef = useRef<AbortController | null>(null);

  // Memoize pool so the effect doesn't re-fire every render
  const selectedKey = selectedIds.join(",");
  const pool = useMemo(
    () => allPokemon.filter((p) => selectedIds.includes(p.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allPokemon, selectedKey]
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled || pool.length === 0) {
      setResult(null);
      setLoading(false);
      setProgress({ done: 0, total: 0 });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setResult(null);
    setProgress({ done: 0, total: 0 });

    findOptimalRotationAsync(
      pool,
      diskLevel,
      (update) => {
        if (!controller.signal.aborted) setProgress(update);
      },
      { damageConfig },
      controller.signal
    )
      .then((res) => {
        if (!controller.signal.aborted) {
          setResult(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("Rotation calculation failed:", err);
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [pool, diskLevel, enabled, damageConfig]);

  return { result, loading, progress, cancel };
}
