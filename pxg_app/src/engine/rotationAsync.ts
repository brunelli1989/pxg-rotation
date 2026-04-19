import type { DamageConfig, DiskLevel, Pokemon, RotationResult } from "../types";
import { combinations, MAX_BAG } from "./rotation";
import type { WorkerMessage, WorkerRequest } from "./rotation.worker";

export interface ProgressUpdate {
  done: number;
  total: number;
}

export interface SearchOptions {
  beamWidth?: number;
  maxCycleLen?: number;
  minCycleLen?: number;
  damageConfig?: DamageConfig;
}

export async function findOptimalRotationAsync(
  pool: Pokemon[],
  diskLevel: DiskLevel,
  onProgress?: (update: ProgressUpdate) => void,
  options?: SearchOptions,
  signal?: AbortSignal
): Promise<RotationResult | null> {
  if (pool.length === 0) return null;
  if (signal?.aborted) return null;

  const allBags: Pokemon[][] =
    pool.length <= MAX_BAG ? [pool] : combinations(pool, MAX_BAG);

  const total = allBags.length;

  const workerCount = Math.max(
    1,
    Math.min(navigator.hardwareConcurrency ?? 4, allBags.length)
  );

  const chunks: Pokemon[][][] = Array.from({ length: workerCount }, () => []);
  allBags.forEach((bag, i) => {
    chunks[i % workerCount].push(bag);
  });

  let totalDone = 0;
  onProgress?.({ done: 0, total });

  const activeWorkers: Worker[] = [];
  const abortHandler = () => {
    for (const w of activeWorkers) w.terminate();
    activeWorkers.length = 0;
  };
  signal?.addEventListener("abort", abortHandler);

  const promises = chunks.map((chunk) => {
    return new Promise<{ bestIdle: number; bestResult: RotationResult | null } | null>(
      (resolve, reject) => {
        const worker = new Worker(
          new URL("./rotation.worker.ts", import.meta.url),
          { type: "module" }
        );
        activeWorkers.push(worker);

        worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
          const msg = e.data;
          if (msg.type === "progress") {
            totalDone += msg.done;
            onProgress?.({ done: Math.min(totalDone, total), total });
          } else if (msg.type === "result") {
            worker.terminate();
            resolve({ bestIdle: msg.bestIdle, bestResult: msg.bestResult });
          }
        };

        worker.onerror = (err) => {
          worker.terminate();
          reject(err);
        };

        signal?.addEventListener("abort", () => resolve(null), { once: true });

        const req: WorkerRequest = {
          bags: chunk,
          diskLevel,
          beamWidth: options?.beamWidth,
          maxCycleLen: options?.maxCycleLen,
          minCycleLen: options?.minCycleLen,
          damageConfig: options?.damageConfig,
        };
        worker.postMessage(req);
      }
    );
  });

  const results = await Promise.all(promises);
  signal?.removeEventListener("abort", abortHandler);
  if (signal?.aborted) return null;

  let bestIdle = Infinity;
  let bestResult: RotationResult | null = null;
  for (const r of results) {
    if (r && r.bestResult && r.bestIdle < bestIdle) {
      bestIdle = r.bestIdle;
      bestResult = r.bestResult!;
    }
  }

  return bestResult;
}
