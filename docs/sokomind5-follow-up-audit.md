# Sokomind follow-up audit

This is the issue list gathered while porting and strengthening Sokomind
Solver. Resolved items remain documented so their regressions stay visible.

## Resolved in this pass

Push-count, combined, and push tie-break objectives were removed from the
public contract. A* and IDA* now optimize the same scalar move cost, and search
state always includes the exact keeper cell. The optimal cache migrated to a
move-only schema; legacy push and combined records are discarded because they
cannot prove a minimum move count.

The adapter no longer estimates memory from cumulative generated states or a
historical heap peak. It now tracks current and peak worker memory separately,
including retained/frontier states, caches, compact arenas, bidirectional
records, prepared geometry, and coordinator records. Regression tests cover
falling live memory and million-state generation without false exhaustion.

The solver dialog saves a proven record only from an empty action log, session
cloning preserves collection metadata, and lowercase `x` is rejected instead
of being normalized into a generic goal.

The editor now has readable scroll-contained cells, all 22 legal typed labels,
accessible drag/keyboard painting, robust Base64URL sharing, and an isolated
playtest with keyboard, swipe, D-pad, undo, restart, counters, and solved
feedback.

## Confirmed defects

### P2: IDA* memory limits are incomplete

IDA* estimates only its transposition table, ignores geometry, heuristic
caches, stack, and buffers, and reports zero estimated bytes at completion. A
one-box solve completed under a declared 128-byte memory ceiling.

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
- The editor playtest is deliberately isolated from saved sessions and the
  full solver dialog. Solver-testing a custom draft would need an explicit
  adapter bridge rather than reusing play-page persistence.
- The bidirectional lane retains every published record until its bounded phase
  ends. Frontier and state budgets cap it, but a compact parent arena would use
  less memory.
- This is a bounded anytime port, not the complete legacy director.
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
  process-wide heap sample includes unrelated application memory. The adapter
  uses live engine-owned estimates and records the process sample only when it
  can identify a trustworthy injected isolate source.
- Hard discovery cases still create substantial allocation churn even when
  their live retained set is bounded. The isolated corpus benchmark has
  observed high process RSS on the typed master rooms; reducing successor
  generation and compacting legacy beam nodes remain performance priorities.

## Repository and documentation debt

- Package, storage, deployment, and architecture text still contain the old
  Sokomind name and site path.
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
