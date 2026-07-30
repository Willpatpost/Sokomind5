# Solver integration

The solver package contains four production adapters plus the infrastructure
needed to add more. An algorithm becomes available by implementing
`SolverAdapter` and registering it at the worker composition root.

## Built-in searches

| Adapter | Frontier | Objectives | Guarantee |
| --- | --- | --- | --- |
| `classic-dfs` | LIFO stack | moves, pushes, combined | deterministic first route |
| `classic-bfs` | FIFO queue | pushes | minimum pushes |
| `classic-greedy` | stable heuristic heap | moves, pushes, combined | deterministic first route |
| `classic-astar` | stable `g + h` heap | moves, pushes, combined | optimal requested cost |

All four use the same push-macro graph. A successor consists of an exact
shortest keeper walk followed by one legal push. Search state retains the true
post-push keeper cell and a canonical signature that treats boxes with the same
label as interchangeable. For the pure push objective, keeper cells in the same
reachable region share one state identity because walking distance is
irrelevant; move-sensitive objectives retain the exact keeper cell.

The A* lower bound is a label-aware minimum-cost assignment. For every matching
box/goal pair, the cost is a reverse-push distance that respects walls and
required support cells while removing all other boxes. The relaxed puzzle
cannot cost more than the real one, so the assignment is admissible:

- push objective: `h = P`;
- move objective: `h = P`, because every remaining push is also a move;
- combined objective: `h = P * (moveWeight + pushWeight)`.

Only proven static dead cells and fully blocked 2x2 formations are hard-pruned.
Every candidate route is reconstructed from parent links and independently
replayed through the core before it is returned.

## Contract

A solver receives:

- immutable `ParsedBoard` geometry;
- an exact `GameSnapshot`, which permits solving from the initial or current
  game state;
- an explicit `SolverObjective`;
- optional resource limits and JSON-safe adapter options;
- an execution context containing an `AbortSignal`, progress callback, and
  monotonic clock.

It returns a `SolverResult`: solved, unsolved, or cancelled. Unexpected defects
are thrown and serialized as `solver/failure` events at a worker boundary.

Register adapters once:

```ts
import { SolverRegistry } from "@/src/solver";
import { mySolver } from "./implementations/my-solver";

export const solverRegistry = new SolverRegistry([mySolver]);
```

Registry IDs are lowercase, URL-safe, stable identifiers. Registration fails
on duplicates; a later implementation never silently replaces an earlier one.

## Worker protocol

The host sends:

- `solver/discover` to request capability metadata;
- `solver/run` with `jobId`, `solverId`, and `SolverRequest`;
- `solver/cancel` with the same `jobId`.

The worker emits:

- `solver/ready` with registered metadata;
- `solver/progress`;
- `solver/result`;
- `solver/failure` for transport, configuration, or implementation errors.

Use `isSolverWorkerCommand()` and `isSolverWorkerEvent()` before dispatch.
Those guards recursively validate the envelope and nested request, geometry,
snapshot, metadata, progress, and result data. The assertion variants expose
structured validation failures. Reject protocol-version mismatches rather than
guessing compatibility.

Maintain one run-scoped cancellation controller per `jobId`. Delete it after a
terminal result or failure. A cancelled job must not emit later progress or
overwrite a newer job's UI state.

`SolverWorkerHost` implements that lifecycle around a registry and worker-side
transport. `SolverWorkerClient` owns main-thread discovery/run/cancel, abort
integration, stale-job suppression, transport cleanup, and result
revalidation. Both use small transport interfaces so their behavior can be
tested without a real browser worker.

The classic engine yields with a macrotask rather than an already-resolved
promise. That gives the worker event loop a chance to receive cancellation
messages during CPU-heavy searches. Progress is emitted at a bounded cadence
with elapsed time, expanded/generated states, live and peak frontier sizes,
deduplication, pruning, heuristic, reachability, depth, and estimated-memory
counters. The dialog keeps only a bounded, throttled status history.
Interactive runs also carry a conservative 128 MiB estimated-memory ceiling so
an unlimited-time search cannot consume the browser tab without bound.

## Hint system

`src/features/game/use-hint-controller.ts` provides a lightweight hint feature
built on top of the solver worker infrastructure. It creates a dedicated worker
lazily on first request and keeps it alive for the duration of the session.

When the player presses H or taps the Hint button (positioned between Undo and
Restart in `GameControls`), the controller submits an A* search with pushes
objective, a 5-second time limit, and a 64 MB memory ceiling. If a solution is
found, the first three steps are extracted and animated through the existing
`playSolverSolution` pipeline. The player sees the moves play out on the board
without the full solver dialog opening.

The hint worker follows the same `SolverWorkerClient` lifecycle as the solver
dialog: discovery, run, cancel, and cleanup. Stale-job suppression ensures
that switching puzzles or restarting mid-hint does not apply outdated steps.

## Implementation requirements

- Never mutate the request or retain it in global mutable state.
- Honor declared limits and check cancellation frequently enough for responsive
  shutdown. Do not claim cooperative cancellation otherwise.
- Report monotonic, finite, non-negative metrics. Report `fraction` only when a
  meaningful bound exists.
- Support every objective listed in metadata and reject unsupported objectives
  before search.
- Give heuristic ties a deterministic final ordering. If randomness is useful,
  make the seed an explicit option and report it.
- Use stable box IDs and exact robot positions. In particular, a hard pruning
  proof may not substitute an arbitrary neighbor for the true post-push player
  cell.
- Keep adapter options namespaced and JSON-safe. Validate unknown, missing, and
  out-of-range values at the boundary.
- Verify candidates with `verifySolverSolution()` or
  `assertVerifiedSolverSolution()` before returning `solved`. Verification
  replays `stepSnapshot()`, requires every step to move, checks walk/push kinds,
  counters, objective score, and the final solved state.

## Testing a solver

Each implementation should have:

1. contract tests for metadata, supported objectives, limits, and cancellation;
2. legality tests that replay every returned solution through the core;
3. targeted safety tests for every hard pruning rule;
4. deterministic fixture tests with fixed outcomes;
5. benchmark gates recording runtime, expanded states, moves, and pushes
   separately;
6. worker protocol tests for stale progress, duplicate job IDs, cancellation,
   malformed messages, and thrown failures.

Grand Hall should be retained as a quality and performance fixture, but no
single puzzle should determine the architecture or algorithm choice.
