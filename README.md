# Sokomind5

A polished, fully static Sokoban application built for GitHub Pages. It keeps
Sokomind3's clean domain and solver boundaries while replacing its server
hosting layer with a portable Vite build.

## Highlights

- All 32 validated puzzles from Sokomind
- Responsive keyboard, touch, and mouse controls
- Animated crates, matching goal sockets, and a characterful keeper
- Optional procedural sound effects and ambient music with no downloaded audio
- Ambient background motion and a one-shot puzzle-completion celebration
- System-aware reduced motion plus persistent sound and motion preferences
- Exact autosave/recovery, undo, guarded restart, and personal bests
- Shareable puzzle/replay links and portable progress import/export
- Installable offline PWA behavior with repository-subpath-safe assets
- Pure immutable game rules with no React or browser dependencies
- DFS, BFS, Greedy, and admissible A* search in a cancellation-safe worker
- Live solver telemetry, bounded status history, and verified route playback
- Automated unit, static, browser, accessibility, and Pages deployment checks

The application has no API, database, account system, or runtime server.
Progress and preferences remain in the browser's local storage.

## Local development

Requirements: Node.js 22.13 or newer.

```powershell
npm install
npm run dev
```

The production build is also an ordinary static directory:

```powershell
npm run build
npm run preview
```

## Quality checks

```powershell
npm run typecheck
npm run lint
npm test
npm run test:browser
```

`npm test` runs domain and preference tests, creates the production build, and
then verifies that every emitted script, stylesheet, and public asset is safe
to deploy beneath a GitHub project-page path. `npm run test:browser` adds
Playwright interaction tests and axe accessibility scans at `/Sokomind3/`.

## GitHub Pages

The workflow at `.github/workflows/deploy-pages.yml` validates and deploys
`dist/` whenever `main` is updated. In the repository's **Settings > Pages**
screen, choose **GitHub Actions** as the publishing source once. No generated
build files need to be committed.

Vite uses `base: "./"`, so the same output works at `/Sokomind3/`, on a custom
domain, and through a local static server. See
[docs/deployment.md](docs/deployment.md) for the complete deployment contract.

## Project structure

```text
Sokomind3/
|-- .github/                 Pages workflow and dependency updates
|-- public/                  PWA, metadata assets, and .nojekyll
|-- scripts/                 Cross-platform Pages preview/test helpers
|-- src/
|   |-- catalog/             Canonical puzzle definitions and indexes
|   |-- core/                Pure parsing, rules, state, and validation
|   |-- features/
|   |   |-- experience/      Audio, music, motion, ambience, celebration
|   |   |-- game/            Board, controls, and play orchestration
|   |   |-- help/            Instructions and keyboard guidance
|   |   |-- library/         Searchable and filterable puzzle curriculum
|   |   |-- progress/        Backup, import, and reset UI
|   |   `-- solver/          Search controls, telemetry, and route playback
|   |-- shared/              Safe storage, replay persistence, dialogs, links
|   |-- solver/              Search engine, adapters, verification, worker runtime
|   |-- App.tsx              UI composition
|   `-- main.tsx             Browser composition root
|-- docs/                    Architecture and extension guides
|-- tests/
|   |-- e2e/                 Playwright and axe browser tests
|   |-- unit/                Deterministic domain and runtime tests
|   `-- static-build.test.mjs
|-- index.html               Static metadata and application mount point
`-- vite.config.ts           Portable static build configuration
```

The dependency direction is intentional:

```text
catalog ----\
             +--> game UI --> App
core -------/

core <------ solver contracts
experience --> game UI and App
```

`src/core` never imports React, storage, animation, audio, or solver code.
Solvers consume the same serializable geometry and snapshot types as the game
and run in a module worker without changing board rendering.

The canonical `U/D/L/R` action log is shared by autosave, exact replay,
shareable routes, and solver playback. Undo uses a persistent linked
history, so long routes do not copy every earlier snapshot per move.

## Documentation

- [Architecture](docs/architecture.md)
- [Experience, sound, and motion](docs/experience.md)
- [GitHub Pages deployment](docs/deployment.md)
- [Solver integration](docs/solver-integration.md)
- [Puzzle format](docs/puzzle-format.md)
- [Testing strategy](docs/testing.md)
- [Persistence and sharing](docs/persistence-and-sharing.md)

## Puzzle data note

Puzzle rows, identifiers, titles, difficulty tiers, hints, and ordering are
preserved from Sokomind. Six legacy `boxes` metadata values disagreed with
their boards; the catalog corrects those values from the rows and locks them
with invariant tests. Grand Hall contains 17 boxes.

## Current scope

This repository is the static user application and extension architecture. Its
first solver family provides deterministic push-macro DFS, push-optimal BFS,
Greedy Best-First, and A*. A* uses a label-aware minimum assignment over
wall-aware reverse-push distances; the bound is admissible for move, push, and
weighted combined objectives. These general searches establish a tested
baseline behind the adapter boundary. More specialized structural and macro
solvers can be added without coupling them to React or board rendering.
