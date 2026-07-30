import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createSession,
  type PuzzleDefinition,
} from "../../src/core/index.ts";
import type { SolverRequest } from "../../src/solver/contracts.ts";
import { search } from "../../src/solver/implementations/sokomind-engine/engine.generated.js";
import {
  solutionFromLegacyPath,
  toLegacyState,
} from "../../src/solver/implementations/sokomind-solver.ts";
import { verifySolverSolution } from "../../src/solver/verification.ts";

const MIXED_TYPED_PUZZLE: PuzzleDefinition = {
  id: "mixed-typed-engine",
  title: "Mixed typed engine",
  difficulty: "tutorial",
  boxes: 2,
  rows: [
    "OOOOOOO",
    "O  R  O",
    "O A X O",
    "O a S O",
    "O     O",
    "OOOOOOO",
  ],
};

function requestFor(puzzle: PuzzleDefinition): SolverRequest {
  const session = createSession(puzzle);
  return {
    board: session.board,
    snapshot: session.snapshot,
    objective: { kind: "pushes", tieBreak: "none" },
  };
}

describe("vendored Sokomind engine", () => {
  it("solves and replay-verifies a mixed generic/dedicated puzzle", () => {
    const originalPostMessage = globalThis.postMessage;
    globalThis.postMessage = (() => {}) as typeof globalThis.postMessage;
    try {
      const request = requestFor(MIXED_TYPED_PUZZLE);
      const result = search({
        algorithm: "ultimate",
        state: toLegacyState(request),
        maxVisited: 20_000,
        beamWidth: 160,
        maxDepth: 80,
      });
      assert.equal(result.status, "solved");
      assert.ok(Array.isArray(result.path));
      const solution = solutionFromLegacyPath(request, result.path);
      assert.ok(solution);
      assert.equal(verifySolverSolution(request, solution).valid, true);
      assert.equal(solution.pushes, 2);
    } finally {
      if (originalPostMessage === undefined) {
        Reflect.deleteProperty(globalThis, "postMessage");
      } else {
        globalThis.postMessage = originalPostMessage;
      }
    }
  });

  it("rehydrates a structured-cloned prepared board without changing the route", () => {
    const originalPostMessage = globalThis.postMessage;
    globalThis.postMessage = (() => {}) as typeof globalThis.postMessage;
    try {
      const request = requestFor(MIXED_TYPED_PUZZLE);
      const state = toLegacyState(request);
      const analysisResult = search({
        algorithm: "analyze-puzzle",
        state,
      });
      const analysis = analysisResult.analysis as
        | { readonly preparedBoard?: unknown }
        | undefined;
      assert.ok(analysis?.preparedBoard);
      const preparedBoard = structuredClone(analysis.preparedBoard);

      const result = search({
        algorithm: "ultimate",
        state: { ...state, preparedBoard },
        maxVisited: 20_000,
        beamWidth: 160,
        maxDepth: 80,
      });

      assert.equal(result.status, "solved");
      assert.ok(Array.isArray(result.path));
      assert.equal(
        (result.performance?.preparedBoardReuses as number | undefined) ?? 0,
        1,
      );
      const solution = solutionFromLegacyPath(request, result.path);
      assert.ok(solution);
      assert.equal(verifySolverSolution(request, solution).valid, true);
    } finally {
      if (originalPostMessage === undefined) {
        Reflect.deleteProperty(globalThis, "postMessage");
      } else {
        globalThis.postMessage = originalPostMessage;
      }
    }
  });
});
