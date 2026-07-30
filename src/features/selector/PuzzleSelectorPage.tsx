import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PUZZLES,
  DIFFICULTY_ORDER,
  getEffectiveCollection,
  getCollectionsForDifficulty,
  getPuzzlesByDifficulty,
  getBoxCountsForFilter,
  type PuzzleDifficulty,
} from "@/src/catalog/puzzles";
import type { PuzzleDefinition } from "@/src/core/model";
import { loadProgress } from "@/src/shared/progress";
import { isOptimal, loadOptimalCache } from "@/src/shared/optimal-cache";
import { ExperienceControls } from "@/src/features/experience";
import {
  useRouter,
  Link,
  homeHash,
  puzzlesHash,
  puzzleDifficultyHash,
  puzzleCollectionHash,
  playHash,
} from "@/src/router";
import type { Route } from "@/src/router";
import styles from "./PuzzleSelectorPage.module.css";

const DIFFICULTY_LABELS: Record<PuzzleDifficulty, string> = {
  tutorial: "Tutorial",
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  expert: "Expert",
  master: "Master",
};

const DIFFICULTY_COLORS: Record<PuzzleDifficulty, string> = {
  tutorial: "var(--sage-500)",
  beginner: "var(--sage-600)",
  intermediate: "var(--blue-500)",
  advanced: "var(--amber-500)",
  expert: "var(--coral-500)",
  master: "var(--ink-700)",
};

type CompletionFilter = "all" | "cleared" | "open";

type SelectorRoute = Extract<
  Route,
  { page: "puzzles" | "puzzles-difficulty" | "puzzles-collection" }
>;

interface PuzzleSelectorPageProps {
  readonly route: SelectorRoute;
}

export function PuzzleSelectorPage({ route }: PuzzleSelectorPageProps) {
  const { navigate } = useRouter();
  const progress = useMemo(() => loadProgress(), []);
  const completedIds = useMemo(
    () => new Set(Object.keys(progress.completed)),
    [progress],
  );
  const optimalCache = useMemo(() => loadOptimalCache(), []);

  useEffect(() => {
    if (route.page === "puzzles") {
      document.title = "Puzzles · Sokomind";
    } else if (route.page === "puzzles-difficulty") {
      document.title = `${DIFFICULTY_LABELS[route.difficulty]} Puzzles · Sokomind`;
    } else {
      document.title = `${route.collection} · Sokomind`;
    }
  }, [route]);

  const findNextUnsolved = useCallback(
    (puzzles: readonly PuzzleDefinition[]) => {
      return puzzles.find((p) => !completedIds.has(p.id))?.id;
    },
    [completedIds],
  );

  if (route.page === "puzzles") {
    return (
      <DifficultyGrid
        completedIds={completedIds}
        findNextUnsolved={findNextUnsolved}
        navigate={navigate}
      />
    );
  }

  if (route.page === "puzzles-difficulty") {
    const collections = getCollectionsForDifficulty(route.difficulty);
    if (collections.length === 1) {
      return (
        <PuzzleListView
          difficulty={route.difficulty}
          collection={collections[0].name}
          completedIds={completedIds}
          directDifficultyView
          optimalCache={optimalCache}
          progress={progress}
          navigate={navigate}
        />
      );
    }
    return (
      <CollectionGrid
        difficulty={route.difficulty}
        collections={collections}
        completedIds={completedIds}
        findNextUnsolved={findNextUnsolved}
        navigate={navigate}
      />
    );
  }

  return (
    <PuzzleListView
      difficulty={route.difficulty}
      collection={route.collection}
      completedIds={completedIds}
      optimalCache={optimalCache}
      progress={progress}
      navigate={navigate}
    />
  );
}

function DifficultyGrid({
  completedIds,
  findNextUnsolved,
  navigate,
}: {
  completedIds: ReadonlySet<string>;
  findNextUnsolved: (p: readonly PuzzleDefinition[]) => string | undefined;
  navigate: (hash: string) => void;
}) {
  const nextId = useMemo(() => findNextUnsolved(PUZZLES), [findNextUnsolved]);

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <div className={styles.topBar}>
          <div className={styles.topBarLeft}>
            <Link href={homeHash()} className={styles.backButton} aria-label="Back to home">
              <span aria-hidden="true">&larr;</span>
            </Link>
            <h1 className={styles.pageTitle}>Choose a difficulty</h1>
          </div>
          <ExperienceControls />
        </div>

        {nextId && (
          <button
            type="button"
            className={styles.nextButton}
            onClick={() => navigate(playHash(nextId))}
          >
            Play next unsolved
          </button>
        )}

        <div className={styles.grid}>
          {DIFFICULTY_ORDER.map((difficulty) => {
            const puzzles = getPuzzlesByDifficulty(difficulty);
            const solved = puzzles.filter((p) => completedIds.has(p.id)).length;
            const pct = puzzles.length > 0 ? (solved / puzzles.length) * 100 : 0;
            return (
              <button
                key={difficulty}
                type="button"
                className={styles.difficultyCard}
                onClick={() => navigate(puzzleDifficultyHash(difficulty))}
              >
                <div className={styles.cardHeader}>
                  <span
                    className={styles.cardDot}
                    style={{ background: DIFFICULTY_COLORS[difficulty] }}
                  />
                  <h2 className={styles.cardName}>{DIFFICULTY_LABELS[difficulty]}</h2>
                </div>
                <div className={styles.cardStats}>
                  <strong>{solved}</strong> of {puzzles.length} cleared
                </div>
                <div className={styles.cardTrack}>
                  <span style={{ width: `${pct}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </main>
  );
}

function CollectionGrid({
  difficulty,
  collections,
  completedIds,
  findNextUnsolved,
  navigate,
}: {
  difficulty: PuzzleDifficulty;
  collections: readonly { name: string; count: number }[];
  completedIds: ReadonlySet<string>;
  findNextUnsolved: (p: readonly PuzzleDefinition[]) => string | undefined;
  navigate: (hash: string) => void;
}) {
  const puzzles = useMemo(() => getPuzzlesByDifficulty(difficulty), [difficulty]);
  const nextId = useMemo(() => findNextUnsolved(puzzles), [findNextUnsolved, puzzles]);

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <div className={styles.topBar}>
          <div className={styles.topBarLeft}>
            <Link href={puzzlesHash()} className={styles.backButton} aria-label="Back to difficulties">
              <span aria-hidden="true">&larr;</span>
            </Link>
            <h1 className={styles.pageTitle}>{DIFFICULTY_LABELS[difficulty]}</h1>
          </div>
          <ExperienceControls />
        </div>

        <nav className={styles.breadcrumb}>
          <Link href={puzzlesHash()}>Puzzles</Link>
          <span>&rsaquo;</span>
          <span className={styles.breadcrumbCurrent}>{DIFFICULTY_LABELS[difficulty]}</span>
        </nav>

        {nextId && (
          <button
            type="button"
            className={styles.nextButton}
            onClick={() => navigate(playHash(nextId))}
          >
            Play next unsolved in {DIFFICULTY_LABELS[difficulty]}
          </button>
        )}

        <div className={styles.grid}>
          {collections.map((col) => {
            const colPuzzles = puzzles.filter(
              (p) => getEffectiveCollection(p) === col.name,
            );
            const solved = colPuzzles.filter((p) => completedIds.has(p.id)).length;
            const pct = col.count > 0 ? (solved / col.count) * 100 : 0;
            return (
              <button
                key={col.name}
                type="button"
                className={styles.collectionCard}
                onClick={() => navigate(puzzleCollectionHash(difficulty, col.name))}
              >
                <h2 className={styles.cardName}>{col.name}</h2>
                <div className={styles.cardStats}>
                  <strong>{solved}</strong> of {col.count} cleared
                </div>
                <div className={styles.cardTrack}>
                  <span style={{ width: `${pct}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </main>
  );
}

function PuzzleListView({
  difficulty,
  collection,
  completedIds,
  optimalCache,
  progress,
  navigate,
  directDifficultyView = false,
}: {
  difficulty: PuzzleDifficulty;
  collection: string;
  completedIds: ReadonlySet<string>;
  optimalCache: ReturnType<typeof loadOptimalCache>;
  progress: ReturnType<typeof loadProgress>;
  navigate: (hash: string) => void;
  directDifficultyView?: boolean;
}) {
  const [boxFilter, setBoxFilter] = useState<number | null>(null);
  const [completionFilter, setCompletionFilter] = useState<CompletionFilter>("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 150);
  }, []);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const allPuzzles = useMemo(
    () =>
      getPuzzlesByDifficulty(difficulty).filter(
        (p) => getEffectiveCollection(p) === collection,
      ),
    [difficulty, collection],
  );

  const boxCounts = useMemo(
    () => getBoxCountsForFilter(difficulty, collection),
    [difficulty, collection],
  );

  const filteredPuzzles = useMemo(() => {
    const needle = debouncedQuery.trim().toLocaleLowerCase();
    return allPuzzles.filter((p) => {
      if (boxFilter !== null && p.boxes !== boxFilter) return false;
      if (completionFilter === "cleared" && !completedIds.has(p.id)) return false;
      if (completionFilter === "open" && completedIds.has(p.id)) return false;
      if (needle && !p.title.toLocaleLowerCase().includes(needle)) return false;
      return true;
    });
  }, [allPuzzles, boxFilter, completionFilter, completedIds, debouncedQuery]);

  const nextUnsolved = useMemo(
    () => allPuzzles.find((p) => !completedIds.has(p.id))?.id,
    [allPuzzles, completedIds],
  );

  const indexMap = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < allPuzzles.length; i++) map.set(allPuzzles[i].id, i);
    return map;
  }, [allPuzzles]);
  const viewLabel = directDifficultyView
    ? DIFFICULTY_LABELS[difficulty]
    : collection;

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <div className={styles.topBar}>
          <div className={styles.topBarLeft}>
            <Link
              href={
                directDifficultyView
                  ? puzzlesHash()
                  : puzzleDifficultyHash(difficulty)
              }
              className={styles.backButton}
              aria-label={
                directDifficultyView
                  ? "Back to difficulties"
                  : "Back to collections"
              }
            >
              <span aria-hidden="true">&larr;</span>
            </Link>
            <h1 className={styles.pageTitle}>{viewLabel}</h1>
          </div>
          <ExperienceControls />
        </div>

        <nav className={styles.breadcrumb}>
          <Link href={puzzlesHash()}>Puzzles</Link>
          <span>&rsaquo;</span>
          {directDifficultyView ? (
            <span className={styles.breadcrumbCurrent}>
              {DIFFICULTY_LABELS[difficulty]}
            </span>
          ) : (
            <>
              <Link href={puzzleDifficultyHash(difficulty)}>
                {DIFFICULTY_LABELS[difficulty]}
              </Link>
              <span>&rsaquo;</span>
              <span className={styles.breadcrumbCurrent}>{collection}</span>
            </>
          )}
        </nav>

        {nextUnsolved && (
          <button
            type="button"
            className={styles.nextButton}
            onClick={() => navigate(playHash(nextUnsolved))}
          >
            Play next unsolved in {viewLabel}
          </button>
        )}

        <div className={styles.filters}>
          {boxCounts.length > 1 && (
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>Boxes</span>
              <button
                type="button"
                className={styles.filterChip}
                data-active={boxFilter === null || undefined}
                onClick={() => setBoxFilter(null)}
              >
                All
              </button>
              {boxCounts.map((count) => (
                <button
                  key={count}
                  type="button"
                  className={styles.filterChip}
                  data-active={boxFilter === count || undefined}
                  onClick={() => setBoxFilter(count)}
                >
                  {count}
                </button>
              ))}
            </div>
          )}

          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Status</span>
            {(["all", "cleared", "open"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={styles.filterChip}
                data-active={completionFilter === value || undefined}
                onClick={() => setCompletionFilter(value)}
              >
                {value.charAt(0).toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>

          <label className={styles.search}>
            <span aria-hidden="true">&#x2315;</span>
            <input
              type="search"
              value={query}
              onChange={handleSearchChange}
              placeholder="Search"
            />
          </label>
        </div>

        {filteredPuzzles.length > 0 ? (
          <div className={styles.puzzleList}>
            {filteredPuzzles.map((puzzle) => {
              const complete = completedIds.has(puzzle.id);
              const record = progress.completed[puzzle.id];
              const optimal = record
                ? isOptimal(optimalCache, puzzle.id, record.moves)
                : false;
              const num = (indexMap.get(puzzle.id) ?? 0) + 1;
              return (
                <button
                  key={puzzle.id}
                  type="button"
                  className={styles.puzzleItem}
                  onClick={() => navigate(playHash(puzzle.id))}
                >
                  <span className={styles.puzzleNumber}>
                    {String(num).padStart(2, "0")}
                  </span>
                  <span className={styles.puzzleCopy}>
                    <strong>{puzzle.title}</strong>
                    <small>
                      {puzzle.rows[0].length} &times; {puzzle.rows.length}
                      {" · "}
                      {puzzle.boxes} {puzzle.boxes === 1 ? "box" : "boxes"}
                    </small>
                  </span>
                  {complete && (
                    <span
                      className={styles.puzzleComplete}
                      style={optimal ? { color: "var(--amber-400)" } : undefined}
                    >
                      {optimal ? "★" : "✓"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className={styles.empty}>
            <strong>No puzzles match</strong>
            <span>Try adjusting your filters.</span>
          </div>
        )}
      </div>
    </main>
  );
}
