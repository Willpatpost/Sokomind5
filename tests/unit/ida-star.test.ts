import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createSession,
  stepSnapshot,
  type GameSnapshot,
  type PuzzleDefinition,
} from "../../src/core/index.ts";
import type {
  SolverExecutionContext,
  SolverObjective,
  SolverRequest,
  SolverResult,
} from "../../src/solver/contracts.ts";
import { runIdaStarSearch } from "../../src/solver/search/ida-star.ts";
import { classicAStarSolver } from "../../src/solver/implementations/index.ts";
import { verifySolverSolution } from "../../src/solver/verification.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TWO_GENERIC_BOXES: PuzzleDefinition = {
  id: "two-generic-boxes",
  title: "Two generic boxes",
  difficulty: "tutorial",
  boxes: 2,
  rows: [
    "OOOOOOO",
    "O SS  O",
    "O XX  O",
    "O  R  O",
    "O     O",
    "OOOOOOO",
  ],
};

const ONE_BOX: PuzzleDefinition = {
  id: "one-box",
  title: "One box",
  difficulty: "tutorial",
  boxes: 1,
  rows: [
    "OOOOO",
    "O S O",
    "O X O",
    "O R O",
    "OOOOO",
  ],
};

/**
 * For the "already solved" test we use the ONE_BOX puzzle and push the box
 * onto the goal to produce a solved snapshot, then feed that to IDA*.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requestFor(
  puzzle: PuzzleDefinition,
  objective: SolverObjective,
  snapshot?: GameSnapshot,
): SolverRequest {
  const session = createSession(puzzle);
  return {
    board: session.board,
    snapshot: snapshot ?? session.snapshot,
    objective,
  };
}

function executionContext(
  progress: SolverExecutionContext["reportProgress"] = () => undefined,
  signal = new AbortController().signal,
): SolverExecutionContext {
  return {
    signal,
    reportProgress: progress,
    now: () => performance.now(),
  };
}

function solved(
  result: SolverResult,
): Extract<SolverResult, { readonly status: "solved" }> {
  assert.equal(result.status, "solved", `Expected solved, got ${result.status}${result.status === "unsolved" ? `: ${result.detail}` : ""}`);
  if (result.status !== "solved") throw new Error("Expected a solved result.");
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IDA* search", () => {
  it("solves a trivial one-box puzzle", async () => {
    const request = requestFor(ONE_BOX, { kind: "moves" });
    const result = solved(
      await runIdaStarSearch(request, executionContext()),
    );

    assert.equal(result.solution.optimality, "proven");
    assert.equal(result.solution.moves, 1);
    assert.equal(result.solution.pushes, 1);
    assert.equal(verifySolverSolution(request, result.solution).valid, true);
  });

  it("solves a two-box puzzle move-optimally", async () => {
    const request = requestFor(TWO_GENERIC_BOXES, { kind: "moves" });

    // Get A* result for comparison
    const astarResult = solved(
      await classicAStarSolver.solve(request, executionContext()),
    );

    const idaResult = solved(
      await runIdaStarSearch(request, executionContext()),
    );

    assert.equal(idaResult.solution.optimality, "proven");
    assert.equal(idaResult.solution.moves, astarResult.solution.moves);
    assert.equal(
      verifySolverSolution(request, idaResult.solution).valid,
      true,
    );
  });

  it("handles already-solved puzzles", async () => {
    // Push the one box onto the goal to create a solved snapshot
    const session = createSession(ONE_BOX);
    const pushed = stepSnapshot(session.board, session.snapshot, "up");
    assert.equal(pushed.pushed, true);
    assert.equal(pushed.snapshot.solved, true);

    const request: SolverRequest = {
      board: session.board,
      snapshot: pushed.snapshot,
      objective: { kind: "moves" },
    };
    const result = solved(
      await runIdaStarSearch(request, executionContext()),
    );

    assert.equal(result.solution.pushes, 0);
    assert.equal(result.solution.moves, 0);
    assert.equal(result.solution.steps.length, 0);
    assert.equal(result.solution.optimality, "proven");
  });

  it("respects cancellation via AbortSignal", async () => {
    const request = requestFor(TWO_GENERIC_BOXES, { kind: "moves" });

    const controller = new AbortController();
    // Cancel immediately
    controller.abort("test cancellation");

    const result = await runIdaStarSearch(
      request,
      executionContext(undefined, controller.signal),
    );

    assert.equal(result.status, "cancelled");
  });

  it("respects maxElapsedMs limit", async () => {
    const request: SolverRequest = {
      ...requestFor(TWO_GENERIC_BOXES, { kind: "moves" }),
      limits: { maxElapsedMs: 0 },
    };

    const result = await runIdaStarSearch(request, executionContext());

    // With 0ms limit, the solver should stop quickly
    assert.ok(
      result.status === "unsolved" || result.status === "solved",
      `Expected unsolved or solved, got ${result.status}`,
    );
    if (result.status === "unsolved") {
      assert.equal(result.reason, "limit-reached");
    }
  });

  it("reports progress during search", async () => {
    const request = requestFor(TWO_GENERIC_BOXES, { kind: "moves" });

    const progressReports: string[] = [];
    const ctx = executionContext((progress) => {
      if (progress.detail) progressReports.push(progress.detail);
    });

    const result = solved(await runIdaStarSearch(request, ctx));

    assert.ok(progressReports.length > 0, "Expected at least one progress report");
    assert.ok(
      progressReports.some((d) => d.includes("IDA*")),
      "Expected progress detail to mention IDA*",
    );
    assert.equal(
      verifySolverSolution(request, result.solution).valid,
      true,
    );
  });

  it("returns metrics with IDA* iteration count", async () => {
    const request = requestFor(TWO_GENERIC_BOXES, { kind: "moves" });
    const result = solved(
      await runIdaStarSearch(request, executionContext()),
    );

    assert.ok(result.metrics.elapsedMs >= 0);
    assert.ok((result.metrics.expandedStates ?? 0) > 0);
    assert.ok((result.metrics.generatedStates ?? 0) > 0);
    assert.ok(
      (result.metrics.counters?.idaStarIterations ?? 0) >= 1,
      "Expected at least 1 IDA* iteration",
    );
  });

  it("solves a partial snapshot correctly", async () => {
    const session = createSession(TWO_GENERIC_BOXES);
    const firstPush = stepSnapshot(session.board, session.snapshot, "up");
    assert.equal(firstPush.pushed, true);

    const request: SolverRequest = {
      board: session.board,
      snapshot: firstPush.snapshot,
      objective: { kind: "moves" },
    };

    const astarResult = solved(
      await classicAStarSolver.solve(request, executionContext()),
    );
    const idaResult = solved(
      await runIdaStarSearch(request, executionContext()),
    );

    assert.equal(idaResult.solution.moves, astarResult.solution.moves);
    assert.equal(
      verifySolverSolution(request, idaResult.solution).valid,
      true,
    );
  });
});
