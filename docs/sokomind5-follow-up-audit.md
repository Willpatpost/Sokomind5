# Sokomind5 follow-up audit

This is the deferred issue list gathered while porting Sokomind Solver. The
solver port does not silently fix unrelated findings below.

## Confirmed defects

### P1: IDA* overstates optimality

`src/solver/search/ida-star.ts` optimizes only its primary scalar contour. It
ignores objective tie-breaks and can overestimate low-weight combined
objectives, while `classic-solvers.ts` advertises every objective as optimal
and the result always says `optimality: "proven"`.

Reproductions from the audit:

- `tiny`, moves then pushes: A* returns 20 moves / 5 pushes; IDA* returns
  20 / 7.
- `beginner-detour`, pushes then moves: A* returns 10 pushes / 24 moves; IDA*
  returns 10 / 26.
- `tiny`, combined weights 0.1 / 0.1: A* scores 2.5; IDA* scores 2.7.

Replay proves legality, not optimality. The dialog trusts the flag and offers
to save the result as proven optimal.

### P2: IDA* memory limits are incomplete

IDA* estimates only its transposition table, ignores geometry, heuristic
caches, stack, and buffers, and reports zero estimated bytes at completion. A
one-box solve completed under a declared 128-byte memory ceiling.

### P2: partial-state proofs can be saved as global proofs

The solver dialog can save a solution found from the current mid-game snapshot
as a globally proven optimum for the initial puzzle. Saving should be allowed
only when the run fingerprint has an empty action log.

### P2: combined optimal-cache semantics lose objective weights

`src/shared/optimal-cache.ts` stores only the `combined` kind, not its weights,
and compares routes by coordinatewise dominance. At 1:1 weights, 20 moves /
5 pushes and 21 / 4 both score 25, but the latter is rejected as non-optimal.

### P2: session cloning drops collection metadata

`PuzzleDefinition.collection` exists, but `clonePuzzle()` in
`src/core/game-session.ts` omits it. Imported puzzles therefore lose their
collection name inside a session.

### P3: lowercase `x` is accepted as a generic goal

Puzzle parsing normalizes every lowercase character, including `x`, to an
uppercase label. The documented generic goal is `S`, and `x` is reserved.

## Solver and worker risks

- The host has no independent watchdog for classic adapters. Their cancellation
  and elapsed limits still depend on cooperative macrotask yields. Sokomind
  Solver avoids this for its synchronous kernel by placing it in a terminable
  nested worker.
- Hint requests can overlap the full solver and are hard-coded to
  `classic-astar`. The hint worker has no startup timeout, `error`, or
  `messageerror` recovery after construction.
- The main solver worker is created when the play page mounts, even while the
  dialog is closed. The large Sokomind engine chunk is lazy until a search, but
  the outer worker still pays startup cost.
- Worker-host capability checks enforce target and objective, but not
  labeled-box, generic-box, partial-state, or cancellation flags.
- Custom editor test mode renders only the board. A custom puzzle cannot open
  the solver from that flow.
- The bidirectional lane retains every published record until its bounded phase
  ends. Frontier and state budgets cap it, but a compact parent arena would use
  less memory.
- This is a bounded first-found port, not the complete legacy director.
  Checkpoint/landmark bridge coordination would broaden coverage when exact
  forward/reverse meetings are sparse; a persistent exact lane would be needed
  before claiming eventual completeness for every solvable puzzle.
- Large structural boards reserve up to 25 seconds, but no more than 70% of a
  finite remaining run, for the low-memory structural lane before discovery.
  This keeps Grand Hall under the current aggregate memory ceiling, but a
  structural miss still starts the other lanes later than the legacy
  memory-heavier race.
- Legacy progress is batched, so state-limit termination can observe a small
  reporting overshoot, but over-limit candidates are rejected. Chromium's
  process-wide heap sample includes unrelated application memory, so the
  adapter uses conservative per-worker state estimates and also accounts for
  retained coordinator records.

## Repository and documentation debt

- Package, storage, deployment, and architecture text still contain the old
  Sokomind3 name and site path.
- The checkout tracks `node_modules`, `dist`, and failed Playwright artifacts
  and has no `.gitignore`.
- The tracked dependency tree was copied from Linux and omitted Windows native
  bindings and command shims. Direct TypeScript/ESLint commands worked, but a
  Windows Vite build required installing the lockfile-pinned Rolldown binding.
- The normal test script has no coverage gate. The new expensive Grand Hall
  guardrail is intentionally separate as `test:solver:huge`.

## Catalog/test coverage

- Current catalog: 2,194 puzzles, 15 typed.
- The 2,162 imported puzzles are currently untyped.
- The port adds mixed typed/generic, partial-state, cancellation, memory,
  compact bidirectional-key, production Chrome, and Grand Hall orientation
  coverage.
- Future pruning work should add exhaustive tiny-state and seeded typed
  differential tests before introducing any new hard rejection.
