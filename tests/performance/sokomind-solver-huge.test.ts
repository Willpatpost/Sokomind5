import assert from "node:assert/strict";
import { test } from "node:test";

import { PUZZLE_BY_ID } from "../../src/catalog/puzzles.ts";
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

const MAXIMUMS = Object.freeze({
  elapsedMs: 60_000,
  moves: 1_300,
  pushes: 350,
  visited: 2_500,
  generated: 20_000,
  retained: 5_000,
  peakFrontier: 600,
});

const REVIEWED_DETERMINISTIC_RESULT = Object.freeze({
  moves: 1_010,
  pushes: 316,
  visited: 1_843,
  generated: 13_844,
  retained: 3_471,
  peakFrontier: 387,
});

function mirrorRows(rows: readonly string[]): readonly string[] {
  return rows.map((row) => [...row].reverse().join(""));
}

function rotateRows(rows: readonly string[]): readonly string[] {
  return [...rows]
    .reverse()
    .map((row) => [...row].reverse().join(""));
}

function requestFor(puzzle: PuzzleDefinition): SolverRequest {
  const session = createSession(puzzle);
  return {
    board: session.board,
    snapshot: session.snapshot,
    objective: { kind: "pushes", tieBreak: "none" },
  };
}

test("Sokomind Solver replay-solves Grand Hall in three orientations", () => {
  const huge = PUZZLE_BY_ID.huge;
  assert.ok(huge);
  const cases = [
    ["base", huge.rows],
    ["mirrored", mirrorRows(huge.rows)],
    ["rotated", rotateRows(huge.rows)],
  ] as const;
  const originalPostMessage = globalThis.postMessage;
  globalThis.postMessage = (() => {}) as typeof globalThis.postMessage;

  try {
    for (const [name, rows] of cases) {
      const request = requestFor({
        ...huge,
        id: `huge-${name}`,
        title: `${huge.title} (${name})`,
        rows,
      });
      const started = performance.now();
      const result = search({
        algorithm: "plan-macro-beam",
        state: toLegacyState(request),
        maxDepth: 460,
        maxVisited: 6_000,
        transpositionLimit: 60_000,
        planBeamWidth: 32,
        planBoxBranches: 6,
        maxPlanSegments: 160,
        planSlack: 240,
        sequenceMacroLimit: 24,
        sequenceMacroExplored: 48,
        sequenceMacroResults: 4,
        targetedMacroExplored: 64,
        progressIntervalMs: 5_000,
      });
      const elapsedMs = performance.now() - started;
      assert.equal(result.status, "solved", `${name} status`);
      assert.ok(Array.isArray(result.path), `${name} path`);
      const solution = solutionFromLegacyPath(request, result.path);
      assert.ok(solution, `${name} solution`);
      assert.equal(
        verifySolverSolution(request, solution).valid,
        true,
        `${name} replay`,
      );
      assert.ok(elapsedMs <= MAXIMUMS.elapsedMs, `${name} elapsed`);
      assert.ok(solution.moves <= MAXIMUMS.moves, `${name} moves`);
      assert.ok(solution.pushes <= MAXIMUMS.pushes, `${name} pushes`);
      assert.ok(
        (result.visited ?? Infinity) <= MAXIMUMS.visited,
        `${name} visited`,
      );
      assert.ok(
        (result.generated ?? Infinity) <= MAXIMUMS.generated,
        `${name} generated`,
      );
      assert.ok(
        (result.retained ?? Infinity) <= MAXIMUMS.retained,
        `${name} retained`,
      );
      assert.ok(
        (result.peakFrontier ?? Infinity) <= MAXIMUMS.peakFrontier,
        `${name} peak frontier`,
      );
      assert.deepEqual(
        {
          moves: solution.moves,
          pushes: solution.pushes,
          visited: result.visited,
          generated: result.generated,
          retained: result.retained,
          peakFrontier: result.peakFrontier,
        },
        REVIEWED_DETERMINISTIC_RESULT,
        `${name} deterministic result`,
      );
      console.info(
        JSON.stringify({
          name,
          elapsedMs: Math.round(elapsedMs),
          moves: solution.moves,
          pushes: solution.pushes,
          visited: result.visited,
          generated: result.generated,
          retained: result.retained,
          peakFrontier: result.peakFrontier,
        }),
      );
    }
  } finally {
    if (originalPostMessage === undefined) {
      Reflect.deleteProperty(globalThis, "postMessage");
    } else {
      globalThis.postMessage = originalPostMessage;
    }
  }
});
