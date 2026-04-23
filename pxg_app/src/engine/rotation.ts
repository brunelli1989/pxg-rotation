// Barrel re-export do módulo rotation refatorado em submódulos.
// Código dividido em 3 arquivos sob ./rotation/:
//   - generate.ts    → geração de lure templates
//   - simulation.ts  → SimContext/SimState/compileLures/applyLure
//   - beam-search.ts → findBestRotation/findBestForBag
export { MAX_BAG, combinations, generateLureTemplates } from "./rotation/generate";
export {
  CAST_TIME,
  KILL_TIME,
  INFEASIBLE,
  buildSimContext,
  emptyState,
  compileLures,
  applyLure,
  SimStatePool,
} from "./rotation/simulation";
export type { SimContext, SimState, CompiledLure } from "./rotation/simulation";
export { findBestRotation, findBestForBag } from "./rotation/beam-search";
