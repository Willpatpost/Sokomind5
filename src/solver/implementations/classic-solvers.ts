import type {
  SolverAdapter,
  SolverCapabilities,
  SolverExecutionContext,
  SolverMetadata,
  SolverRequest,
} from "../contracts.ts";
import {
  runClassicSearch,
  type ClassicSearchStrategy,
} from "../search/engine.ts";
import { runIdaStarSearch } from "../search/ida-star.ts";

function capabilities(
  objectives: SolverCapabilities["objectives"],
  quality: SolverCapabilities["quality"],
): SolverCapabilities {
  return Object.freeze({
    executionTargets: ["main-thread", "web-worker"] as const,
    runtime: "javascript",
    objectives,
    quality,
    labeledBoxes: true,
    genericBoxes: true,
    partialState: true,
    reportsProgress: true,
    cooperativeCancellation: true,
    deterministic: true,
  }) satisfies SolverCapabilities;
}

function classicSolver(
  strategy: ClassicSearchStrategy,
  metadata: Omit<SolverMetadata, "capabilities"> & {
    readonly capabilities: SolverCapabilities;
  },
): SolverAdapter {
  const adapter: SolverAdapter = {
    metadata: Object.freeze(metadata),
    solve(request, context) {
      return runClassicSearch(request, context, { strategy });
    },
  };
  return Object.freeze(adapter);
}

export const classicDfsSolver = classicSolver("dfs", {
  id: "classic-dfs",
  displayName: "Depth-First Search",
  description:
    "Deterministic push-macro DFS. Finds a legal first solution without an optimality claim.",
  version: "1.0.0",
  capabilities: capabilities(
    ["moves", "pushes", "combined"],
    "first-found",
  ),
});

export const classicBfsSolver = classicSolver("bfs", {
  id: "classic-bfs",
  displayName: "Breadth-First Search",
  description:
    "Exact breadth-first push search, optimal for the pure push objective.",
  version: "1.0.0",
  capabilities: capabilities(["pushes"], "optimal"),
});

export const classicGreedySolver = classicSolver("greedy", {
  id: "classic-greedy",
  displayName: "Greedy Best-First",
  description:
    "Assignment-guided deterministic best-first push search for fast first solutions.",
  version: "1.0.0",
  capabilities: capabilities(
    ["moves", "pushes", "combined"],
    "first-found",
  ),
});

export const classicAStarSolver = classicSolver("astar", {
  id: "classic-astar",
  displayName: "A* Search",
  description:
    "Optimal push-macro A* with label-aware reverse-push assignment bounds.",
  version: "1.0.0",
  capabilities: capabilities(
    ["moves", "pushes", "combined"],
    "optimal",
  ),
});

export const classicIdaStarSolver: SolverAdapter = Object.freeze({
  metadata: Object.freeze({
    id: "classic-ida-star",
    displayName: "IDA* (iterative deepening)",
    description:
      "Memory-efficient optimal solver using iterative deepening A*.",
    version: "1.0.0",
    capabilities: capabilities(
      ["moves", "pushes", "combined"],
      "optimal",
    ),
  } satisfies SolverMetadata),
  solve(request: SolverRequest, context: SolverExecutionContext) {
    return runIdaStarSearch(request, context);
  },
});

export const CLASSIC_SOLVERS = Object.freeze([
  classicDfsSolver,
  classicBfsSolver,
  classicGreedySolver,
  classicAStarSolver,
  classicIdaStarSolver,
] as const);
