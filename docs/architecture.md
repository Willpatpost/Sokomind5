# Architecture

Sokomind3 is a static React application organized around an immutable domain
core. Rendering, browsing, persistence, sound, motion, and solving are
consumers of the core rather than alternate owners of game state.

## Runtime shape

```text
index.html
    |
src/main.tsx
    |-- ExperienceProvider
    `-- App
         |-- AmbientBackdrop
         `-- GameApp
              |-- GameHeader
              |-- PuzzleLibrary
              |-- Board
              |-- GameSidebar / GameControls
              |-- ProgressDialog
              |-- SolverDialog
              `-- shared modal dialogs and celebration
```

Vite compiles this graph into `dist/`. There is no server entry point, runtime
route, database, or hosting-specific API. Public paths are relative so the
artifact can live below a GitHub repository path.

## Dependency direction

- `src/core` owns validation, parsing, immutable transitions, and JSON-safe
  types. It has no React, browser storage, sound, animation, or solver imports.
- `src/catalog` owns the curated puzzle definitions and catalog queries.
- `src/solver` owns contracts, discovery, recursive runtime validation,
  independent solution verification, search algorithms, cancellation, and the
  worker host/client. It depends only on core model types.
- `src/features/game` translates input into core transitions and renders the
  resulting session.
- `src/features/experience` owns presentation preferences, Web Audio, reduced
  motion, ambience, and celebration. None of those effects change game rules.
- `src/shared` contains the fail-safe storage boundary, exact session
  persistence, hash routes, progress records, and reusable modal primitives.
- `src/main.tsx` is the composition root. It is the only place that must know
  which application-wide providers exist.

Algorithm adapters live under `src/solver/implementations`. The classic family
shares dense geometry, reachability, assignment, deadlock, and frontier
primitives under `src/solver/search`. Future solver families should keep their
own implementation modules and promote primitives only when multiple
implementations genuinely require them.

## Game state

`ParsedBoard` contains static geometry. `GameSnapshot` contains the dynamic
keeper and box state. Both are immutable and serializable.

`GameSession` is authoritative, and `stepSnapshot()` is the history-free exact
transition used by `move()` and solver verification. The UI never edits
positions directly. Stable box IDs allow the visual layer to animate a piece
across cells without changing its domain identity.

Every successful step appends one canonical `U/D/L/R` action. Undo history is a
persistent linked stack, so a new move allocates one history node instead of
copying the full route. `replayActionLog()` rejects malformed or blocked
actions at their exact index.

`game-feedback.ts` classifies two sessions as a step, push, goal placement,
blocked move, or solve. This pure classification lets sound and animation
respond to an event without entering the core.

## Persistence

Storage access is centralized, namespaced, versioned, and exception-safe:

- `sokomind3.progress.v1`
- `sokomind3.experience.v1`
- `sokomind3.session.v1`

Session coordinates are never deserialized directly; saved actions replay
through the core. Puzzle progress never depends on sound or motion preferences.
See `persistence-and-sharing.md`.

## Audio and animation

Audio is synthesized with the Web Audio API after a user gesture. No binary
audio asset or network request is required. The audio controller owns its
nodes, scheduler, visibility handling, and cleanup.

Piece movement uses stable IDs and FLIP animation in a presentation overlay.
The visual board exposes one concise accessible summary and polite move
announcements instead of hundreds of noninteractive grid cells. CSS animations
are limited to transform and opacity where possible, and both system and
explicit reduced motion disable decorative movement.

## Solver isolation

Algorithms implement `SolverAdapter`; they know nothing about React, dialogs,
storage, or audio. `SolverWorkerHost` owns worker-side jobs, cancellation, and
cleanup. `SolverWorkerClient` suppresses stale jobs and verifies terminal
results. A browser worker is created with a Vite-resolved module URL:

```ts
const worker = new Worker(
  new URL("./solver.worker.ts", import.meta.url),
  { type: "module" },
);
```

All protocol payloads receive strict nested validation. Every solved result is
independently replayed before it is shown or stored. Solver counters and step
classifications are assertions to verify, not replacements for exact replay.

The built-in searches use push-macro edges: each edge is one legal box push
preceded by an exact shortest keeper walk. DFS and Greedy return the first route
they find. BFS is restricted to the pure push objective and proves minimum
pushes. A* supports moves, pushes, and weighted combined cost. Its lower bound
minimum-matches each label group to matching goals using wall- and
support-aware reverse-push distances with all other boxes removed. This is a
relaxation of the real puzzle, so it never overestimates the remaining cost.

Search runs are isolated in `solver.worker.ts`. The engine yields through a
macrotask so run/cancel messages remain responsive, publishes throttled
progress, and enforces elapsed-time, expanded-state, generated-state, and
estimated-memory limits. Only conservative static and fully blocked 2x2
deadlocks are hard-pruned. Parent links retain compact search history; the
exact walking route is reconstructed and replay-verified only after a goal is
found.

For pure push searches, the identity also canonicalizes the keeper's reachable
component, collapsing positions that enable exactly the same next pushes. The
true keeper cell remains on every node for legal reconstruction. Move and
combined objectives keep exact keeper identity because walking distance
contributes to their cost.

## Deadlock bridge

`src/core/deadlock-bridge.ts` bridges game-layer types to the solver's static
deadlock checks without pulling the full solver into the game feature. It
detects corner deadlocks via `isStaticDeadCell` and 2x2 freeze deadlocks via
`createsFullyBlockedTwoByTwoDeadlock`. A `WeakMap<ParsedBoard, CompiledSearchBoard>`
cache avoids recompiling board geometry on every move. The game layer queries
the bridge after each push and marks stuck boxes with a `data-deadlocked`
attribute so the visual layer can highlight them.

## Hint system

`src/features/game/use-hint-controller.ts` manages a lazy solver worker that
runs an A* search with a 5-second time limit, 64 MB memory limit, and pushes
objective. The worker is created on first request and reused across hints
within a session. When a solution is found, the first three steps are played
via `playSolverSolution`. The H key and a toolbar button between Undo and
Restart trigger hint requests. See `solver-integration.md` for worker
lifecycle details.

## Undo trail

`src/features/game/trail-positions.ts` extracts the last six unique robot
positions from the undo history linked list. These are rendered as fading blue
dots in a dedicated trail layer (z-index 2) between the cell grid and the
piece overlay. The trail is hidden when reduced motion is active.

## Move notation

`src/features/game/MoveNotation.tsx` renders a compact arrow-glyph strip
below the board showing the action log as directional symbols. It displays the
last 24 moves with a leading ellipsis for longer sequences and auto-scrolls to
the rightmost entry on each update.

## Puzzle timer

`src/features/game/use-timer.ts` provides a `useTimer` hook that updates via
`requestAnimationFrame`. The timer starts on the first move and resets on
puzzle change or restart. It pauses automatically during modals, solve
playback, background tabs, and solution replay. Display format is M:SS or
H:MM:SS. The elapsed time appears in both the score card and the completion
dialog.

## Solution replay

The completion dialog includes a Replay button that resets the board and plays
back the player's own solution through the existing `playSolverSolution`
pipeline. `decodeActionLog` converts the saved action log into a step sequence
that the replay system can animate.

## Static delivery

The production artifact includes relative assets, a web manifest, install
icons, and a subpath-safe service worker. The PWA shell is an enhancement: a
registration or cache failure cannot block the online game. Canonical and
social URLs are injected from `VITE_PUBLIC_SITE_URL`.

## Correctness safeguards

1. Keep the exact post-push keeper position.
2. Treat deadlock and corral pruning as proof code with positive and negative
   tests.
3. Make the optimization objective explicit.
4. Give ties a deterministic final key.
5. Replay every result and verify legality, moves, pushes, and solved state.
6. Keep speed gates separate from solution-quality gates.

Legacy solver code may enter only through a typed adapter. Global script order
and direct coupling to UI components are not supported integration mechanisms.
