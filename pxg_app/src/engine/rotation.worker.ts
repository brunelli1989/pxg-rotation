import type { DamageConfig, DiskLevel, Pokemon, RotationResult } from "../types";
import { findBestForBag } from "./rotation";

export interface WorkerRequest {
  bags: Pokemon[][];
  diskLevel: DiskLevel;
  beamWidth?: number;
  maxCycleLen?: number;
  minCycleLen?: number;
  damageConfig?: DamageConfig;
}

export type WorkerMessage =
  | { type: "progress"; done: number }
  | {
      type: "result";
      bestIdle: number;
      bestResult: RotationResult | null;
    };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { bags, diskLevel, beamWidth, maxCycleLen, minCycleLen, damageConfig } = e.data;

  let bestIdle = Infinity;
  let bestResult: RotationResult | null = null;

  for (const bag of bags) {
    const res = findBestForBag(bag, diskLevel, {
      beamWidth,
      maxCycleLen,
      minCycleLen,
      damageConfig,
    });
    if (res && res.idle < bestIdle) {
      bestIdle = res.idle;
      bestResult = res.result;
    }
    const progressMsg: WorkerMessage = { type: "progress", done: 1 };
    self.postMessage(progressMsg);
  }

  const done: WorkerMessage = { type: "result", bestIdle, bestResult };
  self.postMessage(done);
};
