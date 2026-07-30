import { isSolverCancellation, throwIfSolverCancelled } from "../cancellation.ts";
import type {
  SolutionStep,
  SolverExecutionContext,
  SolverProgress,
  SolverRequest,
  SolverResult,
  SolverRunMetrics,
} from "../contracts.ts";
import { verifySolverSolution } from "../verification.ts";
import {
  compileSearchBoard,
  SEARCH_DIRECTIONS,
  type CompiledSearchBoard,
} from "./compiled-board.ts";
import {
  createsFullyBlockedTwoByTwoDeadlock,
  isStaticDeadCell,
} from "./deadlocks.ts";
import { AssignmentHeuristic } from "./heuristic.ts";
import { canonicalBoxSignature, toDenseBoxes, type DenseBox } from "./model.ts";
import { KeeperReachability } from "./reachability.ts";
import {
  sortedBoxes,
  movedBoxes,
  fillOccupancy,
  fillDeadlockOccupancy,
  stateKey,
  delayForEventLoop,
  OPPOSITE_DIRECTION,
  PROGRESS_INTERVAL_MS,
  YIELD_INTERVAL_MS,
  YIELD_WORK_INTERVAL,
} from "./engine.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PushRecord {
  readonly boxCell: number;
  readonly directionIndex: number;
}

/**
 * Stack frame for iterative DFS. Each frame carries all the state needed to
 * generate successors. The `childCursor` field tracks which successor to
 * generate next, allowing the frame to be resumed after a child subtree
 * completes.
 *
 * IMPORTANT: `reachable` must be re-flooded each time child generation
 * resumes because KeeperReachability is a reusable workspace -- any flood
 * call by a descendant frame overwrites its internal buffers.
 */
interface StackFrame {
  readonly robot: number;
  readonly boxes: readonly DenseBox[];
  readonly boxSignature: string;
  readonly moves: number;
  readonly pushes: number;
  readonly g: number;
  readonly push?: PushRecord;
  /** Frozen box flags (computed once at expansion, stable across resumes). */
  frozenBoxes: boolean[] | null;
  /** Which (boxIndex * 4 + directionIndex) to try next. */
  childCursor: number;
  /** Whether this node has been expanded (passed f-bound, TT, solved checks). */
  expanded: boolean;
}

interface SearchCounters {
  expanded: number;
  generated: number;
  duplicates: number;
  deadlockPrunes: number;
  infeasiblePrunes: number;
  reachabilityFloods: number;
  peakStackDepth: number;
  maxDepth: number;
  iterations: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSolved(
  board: CompiledSearchBoard,
  boxes: readonly DenseBox[],
): boolean {
  return boxes.every(
    (box) => board.goalLabelByCell[box.cell] === box.label,
  );
}

/**
 * Identify frozen boxes: boxes on their matching goal and locked on both
 * axes by walls or other frozen boxes. Uses a fixpoint loop.
 */
function identifyFrozenBoxes(
  board: CompiledSearchBoard,
  boxes: readonly DenseBox[],
  occupancy: Uint8Array,
): boolean[] {
  const frozen = new Array<boolean>(boxes.length).fill(false);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < boxes.length; i++) {
      if (frozen[i]) continue;
      const box = boxes[i];
      if (board.goalLabelByCell[box.cell] !== box.label) continue;

      const neighbors = board.neighbors[box.cell];
      if (!neighbors) continue;

      const leftCell = neighbors[2] ?? -1;
      const rightCell = neighbors[3] ?? -1;
      const horizontalLocked =
        (leftCell < 0 || isFrozenBoxAt(leftCell, boxes, occupancy, frozen)) ||
        (rightCell < 0 || isFrozenBoxAt(rightCell, boxes, occupancy, frozen));

      const upCell = neighbors[0] ?? -1;
      const downCell = neighbors[1] ?? -1;
      const verticalLocked =
        (upCell < 0 || isFrozenBoxAt(upCell, boxes, occupancy, frozen)) ||
        (downCell < 0 || isFrozenBoxAt(downCell, boxes, occupancy, frozen));

      if (horizontalLocked && verticalLocked) {
        frozen[i] = true;
        changed = true;
      }
    }
  }
  return frozen;
}

function isFrozenBoxAt(
  cell: number,
  boxes: readonly DenseBox[],
  occupancy: Uint8Array,
  frozen: boolean[],
): boolean {
  if (occupancy[cell] === 0) return false;
  for (let i = 0; i < boxes.length; i++) {
    if (boxes[i].cell === cell) return frozen[i];
  }
  return false;
}

function createMetrics(
  context: SolverExecutionContext,
  startedAt: number,
  counters: SearchCounters,
  transpositionSize: number,
  heuristic: AssignmentHeuristic,
): SolverRunMetrics {
  const heuristicStats = heuristic.stats;
  return {
    elapsedMs: Math.max(0, context.now() - startedAt),
    expandedStates: counters.expanded,
    generatedStates: counters.generated,
    peakFrontierSize: counters.peakStackDepth,
    counters: {
      uniqueStates: transpositionSize,
      retainedStates: transpositionSize,
      duplicateStates: counters.duplicates,
      deadlockPrunes: counters.deadlockPrunes,
      infeasiblePrunes: counters.infeasiblePrunes,
      reopens: 0,
      reachabilityFloods: counters.reachabilityFloods,
      identityFloods: 0,
      heuristicCalls: heuristicStats.calls,
      heuristicCacheHits: heuristicStats.cacheHits,
      frontierSize: 0,
      maxDepth: counters.maxDepth,
      estimatedMemoryBytes: 0,
      idaStarIterations: counters.iterations,
    },
  };
}

/**
 * Reconstruct the full move+push sequence from the current path stack.
 * Each frame on the stack (except the root) has a push record; the parent
 * frame (one level up) holds the boxes BEFORE that push.
 */
function reconstructSolution(
  board: CompiledSearchBoard,
  stack: readonly StackFrame[],
  initialRobot: number,
  reachability: KeeperReachability,
): readonly SolutionStep[] {
  const steps: SolutionStep[] = [];
  let currentRobot = initialRobot;

  for (let i = 1; i < stack.length; i++) {
    const frame = stack[i];
    const parentFrame = stack[i - 1];
    const push = frame.push;
    if (!push) {
      throw new Error("IDA* path frame missing push record.");
    }

    const support =
      board.neighbors[push.boxCell]?.[
        OPPOSITE_DIRECTION[push.directionIndex] ?? -1
      ] ?? -1;

    const occupancy = new Uint8Array(board.cellCount);
    for (const box of parentFrame.boxes) occupancy[box.cell] = 1;

    const reachable = reachability.flood(currentRobot, occupancy);
    const walk = reachable.pathTo(support);
    const pushDirection = SEARCH_DIRECTIONS[push.directionIndex]?.direction;
    if (!walk || !pushDirection) {
      throw new Error("IDA* solution path contains an unreachable push.");
    }

    for (const direction of walk) {
      steps.push({ direction, kind: "walk" });
    }
    steps.push({ direction: pushDirection, kind: "push" });

    currentRobot = push.boxCell;
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Main IDA* search
// ---------------------------------------------------------------------------

export async function runIdaStarSearch(
  request: SolverRequest,
  context: SolverExecutionContext,
): Promise<SolverResult> {
  const startedAt = context.now();
  const counters: SearchCounters = {
    expanded: 0,
    generated: 0,
    duplicates: 0,
    deadlockPrunes: 0,
    infeasiblePrunes: 0,
    reachabilityFloods: 0,
    peakStackDepth: 0,
    maxDepth: 0,
    iterations: 0,
  };
  let transpositionSize = 0;
  let collectCurrentMetrics: (() => SolverRunMetrics) | undefined;
  let heuristicForMetrics: AssignmentHeuristic | undefined;

  try {
    throwIfSolverCancelled(context.signal);
    const board = compileSearchBoard(request.board);
    const heuristic = new AssignmentHeuristic(board);
    heuristicForMetrics = heuristic;
    const reachability = new KeeperReachability(board);

    const initialRobot = board.cellAt(
      request.snapshot.robot.row,
      request.snapshot.robot.column,
    );
    if (initialRobot < 0) {
      throw new Error(
        "Solver snapshot robot is not on a compiled floor cell.",
      );
    }
    const initialBoxes = sortedBoxes(
      toDenseBoxes(board, request.snapshot.boxes),
    );

    const metrics = () =>
      createMetrics(
        context,
        startedAt,
        counters,
        transpositionSize,
        heuristic,
      );
    collectCurrentMetrics = metrics;

    const report = (phase: SolverProgress["phase"], detail: string) => {
      context.reportProgress({
        phase,
        elapsedMs: Math.max(0, context.now() - startedAt),
        expandedStates: counters.expanded,
        generatedStates: counters.generated,
        frontierSize: 0,
        counters: metrics().counters,
        detail,
      });
    };

    report("preparing", "Preparing IDA* push search");
    throwIfSolverCancelled(context.signal);

    // Already solved?
    if (isSolved(board, initialBoxes)) {
      report("verifying", "Verifying candidate solution");
      throwIfSolverCancelled(context.signal);
      const solution = {
        steps: [] as readonly SolutionStep[],
        moves: 0,
        pushes: 0,
        objective: request.objective,
        objectiveScore: 0,
        optimality: "proven" as const,
      };
      const verification = verifySolverSolution(request, solution);
      if (!verification.valid) {
        throw new Error(
          `IDA* solver verification failed: ${verification.message}`,
        );
      }
      return { status: "solved", solution, metrics: metrics() };
    }

    // Initial heuristic
    const initialH = heuristic.evaluate(initialBoxes);
    if (!Number.isFinite(initialH)) {
      counters.infeasiblePrunes += 1;
      return {
        status: "unsolved",
        reason: "exhausted",
        detail: "No label-compatible goal assignment is reachable.",
        metrics: metrics(),
      };
    }

    const initialBoxSignature = canonicalBoxSignature(initialBoxes);
    const initialG = 0;

    // Pre-allocate reusable buffers
    const occupancyBuffer = new Uint8Array(board.cellCount);
    const deadlockOccupancyBuffer = new Int32Array(board.cellCount);

    const elapsedLimitReached = () => {
      const maximum = request.limits?.maxElapsedMs;
      return (
        maximum !== undefined &&
        Math.max(0, context.now() - startedAt) >= maximum
      );
    };

    const memoryLimitReached = () => {
      const maximum = request.limits?.maxMemoryBytes;
      if (maximum === undefined) return false;
      return transpositionSize * 128 > maximum;
    };

    // -------------------------------------------------------------------
    // IDA* main loop
    // -------------------------------------------------------------------
    let fLimit = initialG + initialH;
    let limitDetail: string | undefined;

    idaLoop: while (true) {
      counters.iterations += 1;
      let nextLimit = Number.POSITIVE_INFINITY;

      const transposition = new Map<string, number>();
      transpositionSize = 0;

      report(
        "searching",
        `IDA* iteration ${counters.iterations}, f-limit=${fLimit}`,
      );
      throwIfSolverCancelled(context.signal);

      if (elapsedLimitReached()) {
        limitDetail = "Maximum elapsed time reached.";
        break;
      }

      // Path stack: current DFS path from root to active node.
      const pathStack: StackFrame[] = [];

      const rootFrame: StackFrame = {
        robot: initialRobot,
        boxes: initialBoxes,
        boxSignature: initialBoxSignature,
        moves: 0,
        pushes: 0,
        g: initialG,
        frozenBoxes: null,
        childCursor: 0,
        expanded: false,
      };
      pathStack.push(rootFrame);

      let lastProgressAt = context.now();
      let lastYieldAt = lastProgressAt;
      let workSinceYield = 0;

      while (pathStack.length > 0) {
        throwIfSolverCancelled(context.signal);

        if (elapsedLimitReached()) {
          limitDetail = "Maximum elapsed time reached.";
          break idaLoop;
        }

        const now = context.now();
        if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
          report(
            "searching",
            `IDA* iteration ${counters.iterations}, f-limit=${fLimit}, depth=${pathStack.length - 1}`,
          );
          lastProgressAt = now;
        }
        if (
          now - lastYieldAt >= YIELD_INTERVAL_MS ||
          workSinceYield >= YIELD_WORK_INTERVAL
        ) {
          await delayForEventLoop();
          throwIfSolverCancelled(context.signal);
          lastYieldAt = context.now();
          workSinceYield = 0;
          if (elapsedLimitReached()) {
            limitDetail = "Maximum elapsed time reached.";
            break idaLoop;
          }
        }

        if (memoryLimitReached()) {
          limitDetail = "Estimated solver memory limit reached.";
          break idaLoop;
        }

        const frame = pathStack[pathStack.length - 1];

        // ----- First visit: f-bound, TT, solved check, mark expanded -----
        if (!frame.expanded) {
          const h = heuristic.evaluate(frame.boxes);
          if (!Number.isFinite(h)) {
            counters.infeasiblePrunes += 1;
            pathStack.pop();
            continue;
          }

          const f = frame.g + h;
          if (f > fLimit) {
            nextLimit = Math.min(nextLimit, f);
            pathStack.pop();
            continue;
          }

          // Transposition check
          const key = stateKey(frame.robot, frame.boxSignature);
          const previousG = transposition.get(key);
          if (previousG !== undefined && previousG <= frame.g) {
            counters.duplicates += 1;
            pathStack.pop();
            continue;
          }
          transposition.set(key, frame.g);
          if (previousG === undefined) transpositionSize += 1;

          // Solved?
          if (isSolved(board, frame.boxes)) {
            report(
              "verifying",
              "Reconstructing and verifying IDA* solution",
            );
            throwIfSolverCancelled(context.signal);
            transpositionSize = transposition.size;

            const steps = reconstructSolution(
              board,
              pathStack,
              initialRobot,
              reachability,
            );
            const pushCount = steps.reduce(
              (total, step) => total + (step.kind === "push" ? 1 : 0),
              0,
            );
            const solution = {
              steps,
              moves: steps.length,
              pushes: pushCount,
              objective: request.objective,
              objectiveScore: steps.length,
              optimality: "proven" as const,
            };
            const verification = verifySolverSolution(request, solution);
            if (!verification.valid) {
              throw new Error(
                `IDA* solver verification failed: ${verification.message}`,
              );
            }
            throwIfSolverCancelled(context.signal);
            return { status: "solved", solution, metrics: metrics() };
          }

          // Expansion limit
          const maxExpanded = request.limits?.maxExpandedStates;
          if (
            maxExpanded !== undefined &&
            counters.expanded >= maxExpanded
          ) {
            limitDetail = "Maximum expanded-state count reached.";
            break idaLoop;
          }

          counters.expanded += 1;
          workSinceYield += 1;
          counters.maxDepth = Math.max(
            counters.maxDepth,
            pathStack.length - 1,
          );
          counters.peakStackDepth = Math.max(
            counters.peakStackDepth,
            pathStack.length,
          );

          // Compute frozen boxes (stable, does not depend on reachability workspace)
          fillOccupancy(occupancyBuffer, frame.boxes);
          frame.frozenBoxes = identifyFrozenBoxes(
            board,
            frame.boxes,
            occupancyBuffer,
          );

          frame.expanded = true;
          frame.childCursor = 0;
        }

        // ----- Generate the next valid child -----
        // CRITICAL: Re-flood reachability every time we resume child
        // generation, because KeeperReachability is a single reusable
        // workspace and any descendant's flood overwrites its buffers.
        fillOccupancy(occupancyBuffer, frame.boxes);
        const reachable = reachability.flood(frame.robot, occupancyBuffer);
        counters.reachabilityFloods += 1;

        const frozenBoxes = frame.frozenBoxes!;
        const boxCount = frame.boxes.length;
        const totalChildren = boxCount * SEARCH_DIRECTIONS.length;
        let foundChild = false;

        while (frame.childCursor < totalChildren) {
          const cursor = frame.childCursor;
          frame.childCursor += 1;

          const boxIndex = Math.floor(cursor / SEARCH_DIRECTIONS.length);
          const directionIndex = cursor % SEARCH_DIRECTIONS.length;

          if (frozenBoxes[boxIndex]) continue;

          const box = frame.boxes[boxIndex];
          if (!box) continue;
          const neighbors = board.neighbors[box.cell];
          if (!neighbors) continue;

          const destination = neighbors[directionIndex] ?? -1;
          const opposite = OPPOSITE_DIRECTION[directionIndex];
          const support =
            opposite === undefined
              ? -1
              : (neighbors[opposite] ?? -1);

          if (
            destination < 0 ||
            support < 0 ||
            occupancyBuffer[destination] !== 0 ||
            !reachable.isReachable(support)
          ) {
            continue;
          }

          // Generation limit
          const maxGenerated = request.limits?.maxGeneratedStates;
          if (
            maxGenerated !== undefined &&
            counters.generated >= maxGenerated
          ) {
            limitDetail = "Maximum generated-state count reached.";
            break idaLoop;
          }
          counters.generated += 1;
          workSinceYield += 1;

          // Static dead cell
          if (isStaticDeadCell(board, destination, box.label)) {
            counters.deadlockPrunes += 1;
            continue;
          }

          // Move box
          const newBoxes = movedBoxes(frame.boxes, boxIndex, destination);
          fillDeadlockOccupancy(deadlockOccupancyBuffer, newBoxes);
          if (
            createsFullyBlockedTwoByTwoDeadlock(
              board,
              newBoxes,
              destination,
              deadlockOccupancyBuffer,
            )
          ) {
            counters.deadlockPrunes += 1;
            continue;
          }

          const distance = reachable.distanceTo(support);
          if (distance < 0) {
            throw new Error(
              "Reachable support cell has no keeper distance.",
            );
          }

          const newMoves = frame.moves + distance + 1;
          const newPushes = frame.pushes + 1;
          const newG = newMoves;
          const newBoxSignature = canonicalBoxSignature(newBoxes);

          const childFrame: StackFrame = {
            robot: box.cell,
            boxes: newBoxes,
            boxSignature: newBoxSignature,
            moves: newMoves,
            pushes: newPushes,
            g: newG,
            push: { boxCell: box.cell, directionIndex },
            frozenBoxes: null,
            childCursor: 0,
            expanded: false,
          };

          pathStack.push(childFrame);
          foundChild = true;
          break; // Process child before continuing with siblings
        }

        // No more children: backtrack
        if (!foundChild) {
          pathStack.pop();
        }
      }

      transpositionSize = transposition.size;

      if (nextLimit === Number.POSITIVE_INFINITY) {
        return {
          status: "unsolved",
          reason: "exhausted",
          metrics: metrics(),
        };
      }

      fLimit = nextLimit;
    }

    if (limitDetail) {
      return {
        status: "unsolved",
        reason: "limit-reached",
        detail: limitDetail,
        metrics: metrics(),
      };
    }

    return {
      status: "unsolved",
      reason: "exhausted",
      metrics: metrics(),
    };
  } catch (error) {
    if (isSolverCancellation(error) || context.signal.aborted) {
      const fallbackHeuristic =
        heuristicForMetrics ??
        new AssignmentHeuristic(compileSearchBoard(request.board));
      return {
        status: "cancelled",
        metrics:
          collectCurrentMetrics?.() ??
          createMetrics(
            context,
            startedAt,
            counters,
            transpositionSize,
            fallbackHeuristic,
          ),
      };
    }
    throw error;
  }
}
