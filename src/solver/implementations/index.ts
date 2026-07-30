import { CLASSIC_SOLVERS } from "./classic-solvers.ts";
import { sokomindSolver } from "./sokomind-solver.ts";

export const BUILT_IN_SOLVERS = Object.freeze([
  sokomindSolver,
  ...CLASSIC_SOLVERS,
] as const);

export {
  CLASSIC_SOLVERS,
  classicAStarSolver,
  classicBfsSolver,
  classicDfsSolver,
  classicGreedySolver,
  classicIdaStarSolver,
} from "./classic-solvers.ts";

export {
  createSokomindSolverAdapter,
  reconstructBidirectionalPath,
  sokomindSolver,
  sokomindSolverMetadata,
  solutionFromLegacyPath,
  toLegacyState,
  type SokomindEngineWorker,
  type SokomindSolverAdapterOptions,
} from "./sokomind-solver.ts";
