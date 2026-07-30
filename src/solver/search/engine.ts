import {
  isSolverCancellation,
  throwIfSolverCancelled,
} from "../cancellation.ts";
import type {
  SolutionStep,
  SolverExecutionContext,
  SolverObjective,
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
  hasFreezeDeadlock,
  isStaticDeadCell,
} from "./deadlocks.ts";
import { AssignmentHeuristic } from "./heuristic.ts";
import {
  canonicalBoxSignature,
  toDenseBoxes,
  type DenseBox,
} from "./model.ts";
import {
  compareNumberTuples,
  StablePriorityQueue,
} from "./priority-queue.ts";
import { KeeperReachability } from "./reachability.ts";

export type ClassicSearchStrategy = "dfs" | "bfs" | "greedy" | "astar";

export interface ClassicSearchConfiguration {
  readonly strategy: ClassicSearchStrategy;
}

interface PushRecord {
  readonly boxCell: number;
  readonly directionIndex: number;
}

interface SearchNode {
  readonly robot: number;
  readonly boxes: readonly DenseBox[];
  readonly boxSignature: string;
  readonly key: string;
  readonly parentIndex: number;
  readonly push?: PushRecord;
  readonly moves: number;
  readonly pushes: number;
  readonly depth: number;
  readonly g: readonly number[];
  readonly priority: readonly number[];
  readonly estimatedBytes: number;
}

interface SearchCounters {
  expanded: number;
  generated: number;
  duplicates: number;
  deadlockPrunes: number;
  infeasiblePrunes: number;
  reopens: number;
  reachabilityFloods: number;
  identityFloods: number;
  retainedBytes: number;
  peakFrontier: number;
  maxDepth: number;
}

interface Frontier {
  readonly size: number;
  push(nodeIndex: number): void;
  pop(): number | undefined;
}

export const OPPOSITE_DIRECTION = [1, 0, 3, 2] as const;
export const PROGRESS_INTERVAL_MS = 100;
export const YIELD_INTERVAL_MS = 10;
export const YIELD_WORK_INTERVAL = 256;

const SEGMENT_CAPACITY = 4096;

export class QueueFrontier implements Frontier {
  #segments: number[][] = [[]];
  #headIndex = 0;
  #tailSegment = 0;
  #count = 0;

  get size(): number {
    return this.#count;
  }

  push(nodeIndex: number): void {
    let last = this.#segments[this.#tailSegment];
    if (!last || last.length >= SEGMENT_CAPACITY) {
      last = [];
      this.#tailSegment = this.#segments.length;
      this.#segments.push(last);
    }
    last.push(nodeIndex);
    this.#count += 1;
  }

  pop(): number | undefined {
    if (this.#count === 0) return undefined;
    const first = this.#segments[0];
    if (!first) return undefined;
    const value = first[this.#headIndex];
    this.#headIndex += 1;
    this.#count -= 1;
    // Drop consumed first segment — O(1) amortized, no array copying
    if (this.#headIndex >= first.length) {
      this.#segments.shift();
      this.#tailSegment -= 1;
      this.#headIndex = 0;
    }
    return value;
  }
}

class StackFrontier implements Frontier {
  readonly #values: number[] = [];

  get size(): number {
    return this.#values.length;
  }

  push(nodeIndex: number): void {
    this.#values.push(nodeIndex);
  }

  pop(): number | undefined {
    return this.#values.pop();
  }
}

export function sortedBoxes(boxes: readonly DenseBox[]): readonly DenseBox[] {
  return [...boxes].sort(
    (left, right) =>
      left.label.localeCompare(right.label) ||
      left.cell - right.cell ||
      left.id.localeCompare(right.id),
  );
}

export function stateKey(robot: number, boxSignature: string): string {
  return `${String(robot)}|${boxSignature}`;
}

/**
 * Keeper cells in the same box-free connected component enable exactly the
 * same future pushes. They are interchangeable only when walking cost is not
 * part of the requested objective.
 */
function usesReachableRegionIdentity(objective: SolverObjective): boolean {
  return objective.kind === "pushes" && objective.tieBreak === "none";
}

function objectiveScore(
  objective: SolverObjective,
  moves: number,
  pushes: number,
): number {
  switch (objective.kind) {
    case "moves":
      return moves;
    case "pushes":
      return pushes;
    case "combined":
      return moves * objective.moveWeight + pushes * objective.pushWeight;
  }
}

/**
 * The exact lexicographic cost represented by a request. The extra combined
 * fields are deterministic tie-breakers, not part of the declared score.
 */
function objectiveVector(
  objective: SolverObjective,
  moves: number,
  pushes: number,
): readonly number[] {
  switch (objective.kind) {
    case "moves":
      return objective.tieBreak === "pushes"
        ? [moves, pushes]
        : [moves];
    case "pushes":
      return objective.tieBreak === "moves"
        ? [pushes, moves]
        : [pushes];
    case "combined":
      return [
        objectiveScore(objective, moves, pushes),
        pushes,
        moves,
      ];
  }
}

function heuristicVector(
  objective: SolverObjective,
  pushLowerBound: number,
): readonly number[] {
  switch (objective.kind) {
    case "moves":
      return objective.tieBreak === "pushes"
        ? [pushLowerBound, pushLowerBound]
        : [pushLowerBound];
    case "pushes":
      return objective.tieBreak === "moves"
        ? [pushLowerBound, pushLowerBound]
        : [pushLowerBound];
    case "combined":
      return [
        pushLowerBound * (objective.moveWeight + objective.pushWeight),
        pushLowerBound,
        pushLowerBound,
      ];
  }
}

function addVectors(
  left: readonly number[],
  right: readonly number[],
): readonly number[] {
  return left.map((value, index) => value + (right[index] ?? 0));
}

function nodePriority(
  strategy: ClassicSearchStrategy,
  objective: SolverObjective,
  moves: number,
  pushes: number,
  pushLowerBound: number,
): readonly number[] {
  const g = objectiveVector(objective, moves, pushes);
  const h = heuristicVector(objective, pushLowerBound);
  if (strategy === "astar") {
    return [...addVectors(g, h), pushLowerBound, ...g];
  }
  if (strategy === "greedy") {
    return [...h, ...g];
  }
  return [];
}

function isSolved(
  board: CompiledSearchBoard,
  boxes: readonly DenseBox[],
): boolean {
  return boxes.every(
    (box) => board.goalLabelByCell[box.cell] === box.label,
  );
}

function occupancyFor(
  cellCount: number,
  boxes: readonly DenseBox[],
): Uint8Array {
  const occupied = new Uint8Array(cellCount);
  for (const box of boxes) occupied[box.cell] = 1;
  return occupied;
}

/** Clear and refill a pre-existing occupancy buffer (avoids per-call allocation). */
export function fillOccupancy(buffer: Uint8Array, boxes: readonly DenseBox[]): void {
  buffer.fill(0);
  for (const box of boxes) buffer[box.cell] = 1;
}

/** Clear and refill a pre-existing deadlock occupancy buffer (stores box indices, -1 = empty). */
export function fillDeadlockOccupancy(buffer: Int32Array, boxes: readonly DenseBox[]): void {
  buffer.fill(-1);
  for (let i = 0; i < boxes.length; i++) buffer[boxes[i].cell] = i;
}

export function movedBoxes(
  boxes: readonly DenseBox[],
  movedIndex: number,
  destination: number,
): readonly DenseBox[] {
  const moved = boxes.map((box, index) =>
    index === movedIndex ? { ...box, cell: destination } : box,
  );
  return sortedBoxes(moved);
}

function estimateStaticBytes(board: CompiledSearchBoard): number {
  const goalCount = [...board.goalCellsByLabel.values()].reduce(
    (total, cells) => total + cells.length,
    0,
  );
  // Includes topology, positions, position lookup, reverse-push tables, maps,
  // and the reusable reachability workspace with intentionally padded object
  // overhead.
  return (
    1_024 +
    board.cellCount * (80 + goalCount * Int32Array.BYTES_PER_ELEMENT) +
    board.cellByOffset.byteLength
  );
}

// nodes[] retains all nodes (including superseded A* entries) because reconstructSolution() walks parent indices.
function estimateNodeBytes(boxCount: number, key: string): number {
  // SearchNode + V8 object/array overhead + canonical box records + key/map entry.
  // Deliberately biased upward: limits are promises, not heap profiler guesses.
  return 448 + boxCount * 80 + key.length * 2;
}

function estimatedMemoryBytes(
  staticBytes: number,
  counters: SearchCounters,
  uniqueStates: number,
  frontierSize: number,
  heuristicCacheEntries: number,
  boxCount: number,
): number {
  return Math.ceil(
    staticBytes +
      counters.retainedBytes +
      uniqueStates * 96 +
      frontierSize * 56 +
      heuristicCacheEntries * (160 + boxCount * 24),
  );
}

export function delayForEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createMetrics(
  context: SolverExecutionContext,
  startedAt: number,
  counters: SearchCounters,
  frontierSize: number,
  uniqueStates: number,
  retainedStates: number,
  heuristic: AssignmentHeuristic,
  staticBytes: number,
  boxCount: number,
): SolverRunMetrics {
  const heuristicStats = heuristic.stats;
  const memoryBytes = estimatedMemoryBytes(
    staticBytes,
    counters,
    uniqueStates,
    frontierSize,
    heuristicStats.cacheEntries,
    boxCount,
  );
  return {
    elapsedMs: Math.max(0, context.now() - startedAt),
    expandedStates: counters.expanded,
    generatedStates: counters.generated,
    peakFrontierSize: counters.peakFrontier,
    counters: {
      uniqueStates,
      retainedStates,
      duplicateStates: counters.duplicates,
      deadlockPrunes: counters.deadlockPrunes,
      infeasiblePrunes: counters.infeasiblePrunes,
      reopens: counters.reopens,
      reachabilityFloods: counters.reachabilityFloods,
      identityFloods: counters.identityFloods,
      heuristicCalls: heuristicStats.calls,
      heuristicCacheHits: heuristicStats.cacheHits,
      frontierSize,
      maxDepth: counters.maxDepth,
      estimatedMemoryBytes: memoryBytes,
    },
  };
}

function createProgress(
  phase: SolverProgress["phase"],
  detail: string,
  context: SolverExecutionContext,
  startedAt: number,
  counters: SearchCounters,
  frontierSize: number,
  uniqueStates: number,
  retainedStates: number,
  heuristic: AssignmentHeuristic,
  staticBytes: number,
  boxCount: number,
): SolverProgress {
  const metrics = createMetrics(
    context,
    startedAt,
    counters,
    frontierSize,
    uniqueStates,
    retainedStates,
    heuristic,
    staticBytes,
    boxCount,
  );
  return {
    phase,
    elapsedMs: metrics.elapsedMs,
    expandedStates: metrics.expandedStates,
    generatedStates: metrics.generatedStates,
    frontierSize,
    counters: metrics.counters,
    detail,
  };
}

function reconstructSolution(
  board: CompiledSearchBoard,
  nodes: readonly SearchNode[],
  goalIndex: number,
  reachability: KeeperReachability,
): readonly SolutionStep[] {
  const chain: number[] = [];
  let cursor = goalIndex;
  while (cursor >= 0) {
    chain.push(cursor);
    const node = nodes[cursor];
    if (!node || node.parentIndex < 0) break;
    cursor = node.parentIndex;
  }
  chain.reverse();

  const steps: SolutionStep[] = [];
  for (let index = 1; index < chain.length; index += 1) {
    const parent = nodes[chain[index - 1] ?? -1];
    const child = nodes[chain[index] ?? -1];
    const push = child?.push;
    if (!parent || !child || !push) {
      throw new Error("Search parent chain is incomplete.");
    }

    const support =
      board.neighbors[push.boxCell]?.[
        OPPOSITE_DIRECTION[push.directionIndex] ?? -1
      ] ?? -1;
    const occupied = occupancyFor(board.cellCount, parent.boxes);
    const reachable = reachability.flood(parent.robot, occupied);
    const walk = reachable.pathTo(support);
    const pushDirection = SEARCH_DIRECTIONS[push.directionIndex]?.direction;
    if (!walk || !pushDirection) {
      throw new Error("Search parent chain contains an unreachable push.");
    }
    for (const direction of walk) {
      steps.push({ direction, kind: "walk" });
    }
    steps.push({ direction: pushDirection, kind: "push" });
  }
  return steps;
}

function unsupportedConfiguration(
  request: SolverRequest,
  strategy: ClassicSearchStrategy,
): string | undefined {
  if (
    strategy === "bfs" &&
    !(
      request.objective.kind === "pushes" &&
      request.objective.tieBreak === "none"
    )
  ) {
    return "Breadth-first push search supports only pushes with no tie-break.";
  }
  return undefined;
}

/**
 * Shared push-macro engine used by the four classic solver adapters.
 *
 * Every edge is a legal box push preceded by an exact shortest keeper walk.
 * Nodes retain only their parent index and push descriptor; walk segments are
 * recomputed once, after a goal is found.
 */
export async function runClassicSearch(
  request: SolverRequest,
  context: SolverExecutionContext,
  configuration: ClassicSearchConfiguration,
): Promise<SolverResult> {
  const startedAt = context.now();
  const unsupported = unsupportedConfiguration(request, configuration.strategy);
  if (unsupported) {
    return {
      status: "unsolved",
      reason: "unsupported",
      detail: unsupported,
      metrics: { elapsedMs: Math.max(0, context.now() - startedAt) },
    };
  }

  const counters: SearchCounters = {
    expanded: 0,
    generated: 0,
    duplicates: 0,
    deadlockPrunes: 0,
    infeasiblePrunes: 0,
    reopens: 0,
    reachabilityFloods: 0,
    identityFloods: 0,
    retainedBytes: 0,
    peakFrontier: 0,
    maxDepth: 0,
  };
  let collectCurrentMetrics: (() => SolverRunMetrics) | undefined;

  try {
    throwIfSolverCancelled(context.signal);
    const board = compileSearchBoard(request.board);
    const heuristic = new AssignmentHeuristic(board);
    const reachability = new KeeperReachability(board);
    const identityReachability = new KeeperReachability(board);
    const staticBytes = estimateStaticBytes(board);
    const initialRobot = board.cellAt(
      request.snapshot.robot.row,
      request.snapshot.robot.column,
    );
    if (initialRobot < 0) {
      throw new Error("Solver snapshot robot is not on a compiled floor cell.");
    }
    const initialBoxes = sortedBoxes(
      toDenseBoxes(board, request.snapshot.boxes),
    );

    context.reportProgress(
      createProgress(
        "preparing",
        `Preparing ${configuration.strategy.toUpperCase()} push search`,
        context,
        startedAt,
        counters,
        0,
        0,
        0,
        heuristic,
        staticBytes,
        initialBoxes.length,
      ),
    );
    throwIfSolverCancelled(context.signal);

    const regionIdentity = usesReachableRegionIdentity(request.objective);
    const initialBoxSignature = canonicalBoxSignature(initialBoxes);
    let initialIdentityRobot = initialRobot;
    if (regionIdentity) {
      const initialOccupancy = occupancyFor(board.cellCount, initialBoxes);
      initialIdentityRobot = identityReachability.flood(
        initialRobot,
        initialOccupancy,
      ).canonicalCell;
      counters.identityFloods += 1;
    }
    const initialKey = stateKey(initialIdentityRobot, initialBoxSignature);
    const initialHeuristic = heuristic.evaluate(initialBoxes);
    const initialNode: SearchNode = {
      robot: initialRobot,
      boxes: initialBoxes,
      boxSignature: initialBoxSignature,
      key: initialKey,
      parentIndex: -1,
      moves: 0,
      pushes: 0,
      depth: 0,
      g: objectiveVector(request.objective, 0, 0),
      priority: nodePriority(
        configuration.strategy,
        request.objective,
        0,
        0,
        initialHeuristic,
      ),
      estimatedBytes: estimateNodeBytes(initialBoxes.length, initialKey),
    };
    const nodes: SearchNode[] = [initialNode];
    counters.retainedBytes = initialNode.estimatedBytes;

    const heap =
      configuration.strategy === "astar" ||
      configuration.strategy === "greedy"
        ? new StablePriorityQueue<number>((leftIndex, rightIndex) => {
            const left = nodes[leftIndex];
            const right = nodes[rightIndex];
            if (!left || !right) return leftIndex - rightIndex;
            return compareNumberTuples(left.priority, right.priority);
          })
        : undefined;
    const frontier: Frontier =
      configuration.strategy === "dfs"
        ? new StackFrontier()
        : configuration.strategy === "bfs"
          ? new QueueFrontier()
          : {
              get size() {
                return heap?.size ?? 0;
              },
              push(nodeIndex) {
                heap?.enqueue(nodeIndex);
              },
              pop() {
                return heap?.dequeue();
              },
            };
    frontier.push(0);
    counters.peakFrontier = 1;

    const discovered = new Set<string>([initialKey]);
    const bestNodeByKey = new Map<string, number>([[initialKey, 0]]);
    const closed = new Set<string>();
    let uniqueStates = 1;
    let lastProgressAt = context.now();
    let lastYieldAt = lastProgressAt;
    let workSinceYield = 0;

    const metrics = () =>
      createMetrics(
        context,
        startedAt,
        counters,
        frontier.size,
        uniqueStates,
        nodes.length,
        heuristic,
        staticBytes,
        initialBoxes.length,
      );
    collectCurrentMetrics = metrics;
    const report = (phase: SolverProgress["phase"], detail: string) => {
      context.reportProgress(
        createProgress(
          phase,
          detail,
          context,
          startedAt,
          counters,
          frontier.size,
          uniqueStates,
          nodes.length,
          heuristic,
          staticBytes,
          initialBoxes.length,
        ),
      );
    };
    const memoryLimitReached = () => {
      const maximum = request.limits?.maxMemoryBytes;
      if (maximum === undefined) return false;
      const stats = heuristic.stats;
      return (
        estimatedMemoryBytes(
          staticBytes,
          counters,
          uniqueStates,
          frontier.size,
          stats.cacheEntries,
          initialBoxes.length,
        ) > maximum
      );
    };
    const elapsedLimitReached = () => {
      const maximum = request.limits?.maxElapsedMs;
      return (
        maximum !== undefined &&
        Math.max(0, context.now() - startedAt) >= maximum
      );
    };

    report("searching", "Searching push states");
    throwIfSolverCancelled(context.signal);

    if (elapsedLimitReached()) {
      return {
        status: "unsolved",
        reason: "limit-reached",
        detail: "Maximum elapsed time reached during preparation.",
        metrics: metrics(),
      };
    }
    if (memoryLimitReached()) {
      return {
        status: "unsolved",
        reason: "limit-reached",
        detail: "Estimated solver memory limit reached during preparation.",
        metrics: metrics(),
      };
    }
    if (isSolved(board, initialBoxes)) {
      report("verifying", "Verifying candidate solution");
      throwIfSolverCancelled(context.signal);
      const solution = {
        steps: [],
        moves: 0,
        pushes: 0,
        objective: request.objective,
        objectiveScore: 0,
        optimality:
          configuration.strategy === "astar" ||
          configuration.strategy === "bfs"
            ? "proven"
            : "unknown",
      } as const;
      const verification = verifySolverSolution(request, solution);
      if (!verification.valid) {
        throw new Error(`Classic solver verification failed: ${verification.message}`);
      }
      throwIfSolverCancelled(context.signal);
      return { status: "solved", solution, metrics: metrics() };
    }

    if (!Number.isFinite(initialHeuristic)) {
      counters.infeasiblePrunes += 1;
      return {
        status: "unsolved",
        reason: "exhausted",
        detail: "No label-compatible goal assignment is reachable.",
        metrics: metrics(),
      };
    }
    let limitDetail: string | undefined;

    // Pre-allocate reusable buffers to avoid per-node allocations in the hot loop.
    const occupancyBuffer = new Uint8Array(board.cellCount);
    const identityOccupancyBuffer = new Uint8Array(board.cellCount);
    const deadlockOccupancyBuffer = new Int32Array(board.cellCount);

    searchLoop: while (frontier.size > 0) {
      throwIfSolverCancelled(context.signal);
      if (elapsedLimitReached()) {
        limitDetail = "Maximum elapsed time reached.";
        break;
      }

      const now = context.now();
      if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
        report("searching", "Searching push states");
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
          break;
        }
      }

      const nodeIndex = frontier.pop();
      if (nodeIndex === undefined) break;
      const node = nodes[nodeIndex];
      if (!node) continue;

      if (configuration.strategy === "astar") {
        if (bestNodeByKey.get(node.key) !== nodeIndex) continue;
        if (closed.has(node.key)) continue;
      }

      if (isSolved(board, node.boxes)) {
        report("verifying", "Reconstructing and verifying candidate solution");
        throwIfSolverCancelled(context.signal);
        const steps = reconstructSolution(
          board,
          nodes,
          nodeIndex,
          reachability,
        );
        const pushes = steps.reduce(
          (total, step) => total + (step.kind === "push" ? 1 : 0),
          0,
        );
        if (steps.length !== node.moves || pushes !== node.pushes) {
          throw new Error(
            "Reconstructed path counters disagree with the selected search node.",
          );
        }
        const solution = {
          steps,
          moves: steps.length,
          pushes,
          objective: request.objective,
          objectiveScore: objectiveScore(
            request.objective,
            steps.length,
            pushes,
          ),
          optimality:
            configuration.strategy === "astar" ||
            configuration.strategy === "bfs"
              ? "proven"
              : "unknown",
        } as const;
        const verification = verifySolverSolution(request, solution);
        if (!verification.valid) {
          throw new Error(
            `Classic solver verification failed: ${verification.message}`,
          );
        }
        throwIfSolverCancelled(context.signal);
        return { status: "solved", solution, metrics: metrics() };
      }

      const maxExpanded = request.limits?.maxExpandedStates;
      if (
        maxExpanded !== undefined &&
        counters.expanded >= maxExpanded
      ) {
        limitDetail = "Maximum expanded-state count reached.";
        break;
      }

      counters.expanded += 1;
      workSinceYield += 1;
      if (configuration.strategy === "astar") closed.add(node.key);

      fillOccupancy(occupancyBuffer, node.boxes);
      const occupied = occupancyBuffer;
      const reachable = reachability.flood(node.robot, occupied);
      counters.reachabilityFloods += 1;
      const children: number[] = [];

      for (let boxIndex = 0; boxIndex < node.boxes.length; boxIndex += 1) {
        const box = node.boxes[boxIndex];
        if (!box) continue;
        const neighbors = board.neighbors[box.cell];
        if (!neighbors) continue;

        for (
          let directionIndex = 0;
          directionIndex < SEARCH_DIRECTIONS.length;
          directionIndex += 1
        ) {
          const destination = neighbors[directionIndex] ?? -1;
          const opposite = OPPOSITE_DIRECTION[directionIndex];
          const support =
            opposite === undefined ? -1 : (neighbors[opposite] ?? -1);
          if (
            destination < 0 ||
            support < 0 ||
            occupied[destination] !== 0 ||
            !reachable.isReachable(support)
          ) {
            continue;
          }

          const maxGenerated = request.limits?.maxGeneratedStates;
          if (
            maxGenerated !== undefined &&
            counters.generated >= maxGenerated
          ) {
            limitDetail = "Maximum generated-state count reached.";
            break searchLoop;
          }
          counters.generated += 1;
          workSinceYield += 1;

          if (isStaticDeadCell(board, destination, box.label)) {
            counters.deadlockPrunes += 1;
            continue;
          }

          const boxes = movedBoxes(node.boxes, boxIndex, destination);
          fillDeadlockOccupancy(deadlockOccupancyBuffer, boxes);
          if (
            createsFullyBlockedTwoByTwoDeadlock(board, boxes, destination, deadlockOccupancyBuffer)
          ) {
            counters.deadlockPrunes += 1;
            continue;
          }

          if (hasFreezeDeadlock(board, boxes, deadlockOccupancyBuffer)) {
            counters.deadlockPrunes += 1;
            continue;
          }

          const distance = reachable.distanceTo(support);
          if (distance < 0) {
            throw new Error("Reachable support cell has no keeper distance.");
          }
          const moves = node.moves + distance + 1;
          const pushes = node.pushes + 1;
          const boxSignature = canonicalBoxSignature(boxes);
          let identityRobot = box.cell;
          if (regionIdentity) {
            fillOccupancy(identityOccupancyBuffer, boxes);
            const childOccupancy = identityOccupancyBuffer;
            identityRobot = identityReachability.flood(
              box.cell,
              childOccupancy,
            ).canonicalCell;
            counters.identityFloods += 1;
          }
          const key = stateKey(identityRobot, boxSignature);
          const g = objectiveVector(request.objective, moves, pushes);

          if (configuration.strategy === "astar") {
            const bestIndex = bestNodeByKey.get(key);
            const best = bestIndex === undefined ? undefined : nodes[bestIndex];
            if (best && compareNumberTuples(g, best.g) >= 0) {
              counters.duplicates += 1;
              continue;
            }
          } else if (discovered.has(key)) {
            counters.duplicates += 1;
            continue;
          }

          const pushLowerBound = heuristic.evaluate(boxes);
          const maxMemoryAfterHeuristic = request.limits?.maxMemoryBytes;
          if (
            maxMemoryAfterHeuristic !== undefined &&
            estimatedMemoryBytes(
              staticBytes,
              counters,
              uniqueStates,
              frontier.size,
              heuristic.stats.cacheEntries,
              initialBoxes.length,
            ) > maxMemoryAfterHeuristic
          ) {
            limitDetail = "Estimated solver memory limit reached.";
            break searchLoop;
          }
          if (!Number.isFinite(pushLowerBound)) {
            counters.infeasiblePrunes += 1;
            continue;
          }

          const candidate: SearchNode = {
            robot: box.cell,
            boxes,
            boxSignature,
            key,
            parentIndex: nodeIndex,
            push: { boxCell: box.cell, directionIndex },
            moves,
            pushes,
            depth: node.depth + 1,
            g,
            priority: nodePriority(
              configuration.strategy,
              request.objective,
              moves,
              pushes,
              pushLowerBound,
            ),
            estimatedBytes: estimateNodeBytes(boxes.length, key),
          };

          const projectedBytes = counters.retainedBytes + candidate.estimatedBytes;
          const maxMemory = request.limits?.maxMemoryBytes;
          if (maxMemory !== undefined) {
            const stats = heuristic.stats;
            const projectedMemory = Math.ceil(
              staticBytes +
                projectedBytes +
                (uniqueStates + 1) * 96 +
                (frontier.size + 1) * 56 +
                stats.cacheEntries * (160 + initialBoxes.length * 24),
            );
            if (projectedMemory > maxMemory) {
              limitDetail = "Estimated solver memory limit reached.";
              break searchLoop;
            }
          }

          const childIndex = nodes.length;
          nodes.push(candidate);
          counters.retainedBytes = projectedBytes;
          counters.maxDepth = Math.max(counters.maxDepth, candidate.depth);

          if (configuration.strategy === "astar") {
            const previous = bestNodeByKey.get(key);
            if (previous === undefined) {
              uniqueStates += 1;
            } else if (closed.delete(key)) {
              counters.reopens += 1;
            }
            bestNodeByKey.set(key, childIndex);
          } else {
            discovered.add(key);
            uniqueStates += 1;
          }
          children.push(childIndex);
        }
      }

      if (configuration.strategy === "dfs") children.reverse();
      for (const childIndex of children) frontier.push(childIndex);
      counters.peakFrontier = Math.max(
        counters.peakFrontier,
        frontier.size,
      );
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
      return {
        status: "cancelled",
        metrics: collectCurrentMetrics?.() ?? {
          elapsedMs: Math.max(0, context.now() - startedAt),
          expandedStates: counters.expanded,
          generatedStates: counters.generated,
          peakFrontierSize: counters.peakFrontier,
          counters: {
            uniqueStates: 0,
            retainedStates: 0,
            duplicateStates: counters.duplicates,
            deadlockPrunes: counters.deadlockPrunes,
            infeasiblePrunes: counters.infeasiblePrunes,
            reopens: counters.reopens,
            reachabilityFloods: counters.reachabilityFloods,
            identityFloods: counters.identityFloods,
            heuristicCalls: 0,
            heuristicCacheHits: 0,
            frontierSize: 0,
            maxDepth: counters.maxDepth,
            estimatedMemoryBytes: 0,
          },
        },
      };
    }
    throw error;
  }
}
