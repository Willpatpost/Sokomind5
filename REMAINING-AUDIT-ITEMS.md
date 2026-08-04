# Remaining Audit Items: Q8

Q8 is algorithmic research for parity between the classic solvers and the production
Sokomind engine.

---

## Q8: Tunnel Macros, Goal Macros, and Corral Detection

### What It Is

The classic A\* and IDA\* solvers generate successors one push at a time. Every
single-cell box movement creates a new search node, even when the outcome is
forced (tunnels), the order is predetermined (goal rooms), or the push is
provably irrelevant (corrals). These classical Sokoban techniques are not yet
integrated into `src/solver/search/engine.ts` and
`src/solver/search/ida-star.ts`.

The production Sokomind engine is materially further ahead: its source modules
compile tunnel segments, use tunnel-aware push expansion, maintain goal-room
packing tables, and perform exact-player-region corral analysis. Q8 therefore
tracks classic-solver parity and further proof/benchmark work; it must not be
read as claiming those techniques are absent from the application as a whole.

**Tunnel macros**: When a box enters a 1-wide corridor, it can only exit from one of two ends. The solver should skip all intermediate states and emit only the two exit states, eliminating O(corridor\_length) nodes per tunnel push.

**Goal macros**: When a goal area has a single entrance and contains only goals, boxes must enter in a specific order and go to specific positions. The solver can precompute this ordering and jump directly to the final placement, pruning the entire subtree of intermediate states.

**Corral pruning**: A corral is a region enclosed by boxes and walls that the keeper cannot enter. If all goals in a corral are already satisfied (or no goals exist there), any push into that region is futile and can be pruned. This is a per-state check, not a static precomputation.

### Current State

The codebase has three deadlock detectors in `src/solver/search/deadlocks.ts` (182 lines):

| Detector | Type | Description |
|----------|------|-------------|
| Static dead cell | Pre-computed | A cell is dead for label L if no matching goal is reachable via reverse-push |
| 2x2 deadlock | Per-state | Any 2x2 block of walls/boxes with a misplaced box is dead |
| Freeze deadlock | Per-state | Fixpoint: a box frozen on both axes and not on its goal is dead |

These three typed detectors do not themselves address tunnels, goal rooms, or
corrals. The production engine implements related logic under
`src/solver/implementations/sokomind-engine/source/`; its sequence planning and
topology-aware push macros are distinct from adding equivalent behavior to the
classic A\*/IDA\* successor loops.

### Why It Is Hard

- **Tunnel detection** requires a static analysis pass over the board topology to identify 1-wide corridors, their entry/exit cells, and how they interact with goals. This analysis belongs in `src/solver/search/compiled-board.ts` and must integrate with the existing `ReachabilityTopology`. Estimated: 200-300 lines of new code.
- **Goal macros** require identifying goal rooms (connected components of goal cells behind single-entrance chokepoints), computing forced entry orderings, and validating that the macro is safe (no label conflicts). This is the most algorithmically complex of the three. Estimated: 300-400 lines.
- **Corral pruning** requires a reachability partition at each search state to identify enclosed regions the keeper cannot access. This is a per-node cost, so it must be fast enough that the pruning benefit outweighs the detection cost. Estimated: 200-250 lines across `deadlocks.ts` and the successor loops.
- All three require changes to both the A\* and IDA\* successor loops, doubling the integration surface.
- Correctness is critical: an incorrect macro or prune silently makes solvable puzzles appear unsolvable.

### What We Can Do

**Phase 1 - Tunnel macros (highest ROI, lowest risk)**

1. Add a `TunnelAnalysis` to `compiled-board.ts` that identifies 1-wide corridors during board compilation. A corridor cell has exactly 2 walkable neighbors along one axis and walls on the perpendicular axis.
2. In the successor loop of both engines, when a push moves a box into a tunnel entry cell, emit successor states for each tunnel exit instead of the single-push state.
3. The tunnel exit states skip all intermediate cells, so the `moves` count on the successor must account for the keeper walking through the tunnel to reach each push position.

**Phase 2 - Corral pruning (medium ROI, medium risk)**

1. After generating each successor state, partition the board into keeper-reachable and keeper-unreachable regions using the existing `KeeperReachability` flood.
2. For each unreachable region, check if all goals within it are satisfied. If yes, mark any push that targets a cell in that region as prunable.
3. This piggybacks on the reachability flood that already runs for canonical robot position (S1), so the incremental cost is the region analysis, not the flood itself.

**Phase 3 - Goal macros (highest complexity, highest reward for goal-heavy puzzles)**

1. During board compilation, identify goal rooms: connected components of goal cells where all paths to the rest of the board pass through a single chokepoint cell.
2. For each goal room, precompute the forced entry ordering using reverse-push analysis from the innermost goal outward.
3. In the successor loop, when a push would move a box into a goal room, validate against the forced ordering. If the box is next in order, emit a successor with the box placed on its final goal position. Otherwise, prune the push.

### How It Helps the Project

- **Solver speed**: Tunnel macros alone can reduce node count by 30-60% on corridor-heavy puzzles (Junghanns & Schaeffer, 2001). Corral pruning adds another 10-30% on open-floor puzzles. Goal macros can prune entire subtrees for goal-room puzzles.
- **AlphaEvolve fitness**: Faster solves = higher fitness scores in the benchmark harness. The tuning surface could also expose macro aggressiveness as a tunable parameter.
- **Puzzle coverage**: Some expert/master puzzles may currently time out. Better pruning makes them solvable within the benchmark time budget, improving solve rate and mean fitness.

### Files That Would Change

| File | Change |
|------|--------|
| `src/solver/search/compiled-board.ts` | Tunnel analysis, goal room identification |
| `src/solver/search/engine.ts` | Successor loop: tunnel expansion, corral check |
| `src/solver/search/ida-star.ts` | Same successor changes mirrored |
| `src/solver/search/deadlocks.ts` | Corral detection function |
| `src/solver/search/model.ts` | New types for tunnel/goal room data |

### References

- Junghanns, A. & Schaeffer, J. (2001). "Sokoban: Enhancing General Single-Agent Search Methods Using Domain Knowledge." *Artificial Intelligence*, 129(1-2), 219-251.
- Junghanns, A. & Schaeffer, J. (1998). "Single-Agent Search in the Presence of Deadlocks." *AAAI-98*.
- Virkkala, T. (2011). "Solving Sokoban." Master's thesis, University of Helsinki.

---

## Summary and Recommended Order

| Priority | Item | Effort | Impact | Approach |
|----------|------|--------|--------|----------|
| 1 | **Q8 Phase 1** | Medium | High | Tunnel macros in compiled-board + both search engines |
| 2 | **Q8 Phase 2** | Medium | Medium | Corral pruning piggybacking on existing reachability flood |
| 3 | **Q8 Phase 3** | High | High | Goal macros with forced ordering precomputation |

Q8 is phased so each technique can be validated independently.

### Estimated Total Effort

| Work Item | Lines of Code | Days (est.) |
|-----------|--------------|-------------|
| Tunnel macros (Q8 Phase 1) | 200-300 | 2-3 |
| Corral pruning (Q8 Phase 2) | 200-250 | 2 |
| Goal macros (Q8 Phase 3) | 300-400 | 3-4 |