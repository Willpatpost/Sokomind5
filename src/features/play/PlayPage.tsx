import { lazy, Suspense, useRef } from "react";
import { PUZZLES } from "@/src/catalog/puzzles";
import { ConfirmDialog } from "@/src/shared/ui/ConfirmDialog";
import { isOptimal } from "@/src/shared/optimal-cache";
import { HowToPlay } from "@/src/features/help/HowToPlay";
import { CelebrationOverlay, ExperienceControls } from "@/src/features/experience";
import { Board } from "@/src/features/game/Board";
import { CompletionDialog } from "@/src/features/game/CompletionDialog";
import { GameSidebar } from "@/src/features/game/GameSidebar";
import { MoveNotation } from "@/src/features/game/MoveNotation";
import { useSwipeControls } from "@/src/features/game/use-swipe-controls";
import { Link, puzzlesHash } from "@/src/router";
import { usePlayController } from "./use-play-controller";
import styles from "./PlayPage.module.css";

const SolverDialog = lazy(() =>
  import("@/src/features/solver/SolverDialog").then((m) => ({
    default: m.SolverDialog,
  })),
);
const ProgressDialog = lazy(() =>
  import("@/src/features/progress/ProgressDialog").then((m) => ({
    default: m.ProgressDialog,
  })),
);

function difficultyLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

interface PlayPageProps {
  readonly puzzleId: string;
  readonly actionLog?: string;
}

export function PlayPage({ puzzleId, actionLog }: PlayPageProps) {
  const game = usePlayController(puzzleId, actionLog);
  const { session, progress } = game;
  const boardWrapRef = useRef<HTMLDivElement>(null);

  useSwipeControls(boardWrapRef, {
    enabled: !game.playback.active,
    onSwipe: game.attemptMove,
  });

  const { puzzle } = session;
  const best = progress.completed[puzzle.id];

  const currentIsOptimal = best
    ? isOptimal(game.optimalCache, puzzle.id, best.moves)
    : false;

  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#game-stage">Skip to puzzle</a>

      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link href={puzzlesHash()} className={styles.backButton} aria-label="Back to puzzles">
            <span aria-hidden="true">&larr;</span>
          </Link>
          <Link href={puzzlesHash()} className={styles.brandSmall} aria-label="Sokomind home">
            <span className={styles.brandMark} aria-hidden="true">
              <span /><span /><span /><span />
            </span>
            <strong>Sokomind</strong>
          </Link>
        </div>

        <div className={styles.headerActions}>
          <ExperienceControls />
          <button
            aria-label="Open solver laboratory"
            className={styles.utilityButton}
            type="button"
            onClick={game.openSolver}
          >
            <span aria-hidden="true">S</span>
            <span className={styles.buttonLabel}>Solve</span>
          </button>
          <button
            aria-label="Share this puzzle and route"
            className={styles.utilityButton}
            type="button"
            onClick={() => void game.handleShare()}
          >
            <span aria-hidden="true">{"\u2197"}</span>
            <span className={styles.buttonLabel}>Share</span>
          </button>
          <button
            aria-label="How to play"
            className={styles.utilityButton}
            type="button"
            onClick={game.openHelp}
          >
            <span aria-hidden="true">?</span>
            <span className={styles.buttonLabel}>Help</span>
          </button>
        </div>
      </header>

      <div className={styles.workspace}>
        <section
          className={styles.stage}
          id="game-stage"
          aria-labelledby="puzzle-title"
          tabIndex={-1}
        >
          <div className={styles.stageHeader}>
            <div>
              <p className={styles.stageEyebrow}>
                {difficultyLabel(puzzle.difficulty)} room
              </p>
              <h1 id="puzzle-title">{puzzle.title}</h1>
            </div>
            <div className={styles.levelPosition}>
              Puzzle
              <strong>
                {String(game.puzzleIndex + 1).padStart(2, "0")} / {game.totalPuzzles}
              </strong>
            </div>
          </div>

          <div className={styles.boardWrap} ref={boardWrapRef}>
            <Board
              session={session}
              reduceMotion={game.reducedMotion}
              deadlockedBoxIds={game.deadlockedBoxIds}
            />
          </div>

          <MoveNotation actionLog={session.actionLog} moves={session.moves} />

          {puzzle.hint ? (
            <div className={styles.hint}>
              <strong>Room note</strong>
              <span>{puzzle.hint}</span>
            </div>
          ) : null}
        </section>

        <GameSidebar
          best={best}
          controlsDisabled={game.playback.active}
          elapsed={game.elapsed}
          isOptimal={currentIsOptimal}
          canHint={game.hint.canHint}
          hintThinking={game.hint.phase === "thinking"}
          session={session}
          onMove={game.attemptMove}
          onHint={game.hint.requestHint}
          onReset={game.requestReset}
          onUndo={game.handleUndo}
        />
      </div>

      <HowToPlay open={game.helpOpen} onClose={game.closeHelp} />

      <Suspense fallback={null}>
        <ProgressDialog
          open={game.progressOpen}
          progress={progress}
          puzzles={PUZZLES}
          onClose={game.closeProgress}
          onImport={game.importProgress}
          onReset={game.resetProgress}
        />
      </Suspense>

      <Suspense fallback={null}>
        <SolverDialog
          onClose={game.closeSolver}
          onPlay={game.playSolverSolution}
          onSaveOptimal={game.saveOptimalRecord}
          open={game.solverOpen}
          session={session}
        />
      </Suspense>

      <ConfirmDialog
        confirmLabel="Restart room"
        destructive
        message={game.resetMessage}
        onClose={game.closeResetConfirm}
        onConfirm={game.performReset}
        open={game.resetConfirmOpen}
        title="Restart this room?"
      />

      <CelebrationOverlay
        active={game.completionOpen}
        message={game.completionAnnouncement}
      />

      <CompletionDialog
        elapsedTime={game.elapsed}
        isOptimalSolution={isOptimal(game.optimalCache, puzzle.id, session.moves)}
        moves={session.moves}
        newBest={game.completionResult.newBest}
        nextLabel={game.nextPuzzle ? "Next room" : "Browse puzzles"}
        onClose={game.closeCompletion}
        onReplay={game.replaySolution}
        onNext={() =>
          game.nextPuzzle
            ? game.selectPuzzle(game.nextPuzzle.id)
            : game.goToPuzzles()
        }
        open={game.completionOpen}
        previousBest={game.completionResult.previousBest}
        pushes={session.pushes}
        title={puzzle.title}
      />

      {game.playback.active ? (
        <div
          className={styles.playbackBar}
          aria-label={`Playing solver route, move ${game.playback.current} of ${game.playback.total}`}
        >
          <span>
            Playing solution
            <strong>
              {game.playback.current} / {game.playback.total}
            </strong>
          </span>
          <button type="button" onClick={game.stopSolutionPlayback}>
            Stop
          </button>
        </div>
      ) : null}

      {game.toast ? (
        <div className={styles.toast} role="status" aria-live="polite">
          {game.toast}
        </div>
      ) : null}
    </main>
  );
}
