import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  move,
  reset,
  undo,
  type Direction,
} from "@/src/core";
import { decodeActionLog } from "@/src/core/action-log";
import { PUZZLES } from "@/src/catalog/puzzles";
import type { ProgressData } from "@/src/shared/progress";
import {
  loadOptimalCache,
  saveOptimalCache,
  setOptimalRecord,
  type OptimalRecord,
} from "@/src/shared/optimal-cache";
import {
  useExperience,
  type AudioCue,
} from "@/src/features/experience";
import { detectDeadlock, findPushedBox } from "@/src/core/deadlock-bridge";
import { classifyMove } from "@/src/features/game/game-feedback";
import { useGameKeyboard } from "@/src/features/game/use-game-keyboard";
import type { SolutionStep } from "@/src/solver";
import { useHintController } from "@/src/features/game/use-hint-controller";
import { useTimer } from "@/src/features/game/use-timer";
import { usePersistedPlay, type CompletionRecordUpdate } from "./use-persisted-play";
import { useRouter, playHash, puzzlesHash } from "@/src/router";
import { createShareUrl } from "@/src/router/navigation";

const MAX_SHARED_ACTIONS = 2_000;

const FEEDBACK_CUES: Readonly<Record<ReturnType<typeof classifyMove>, AudioCue>> = {
  blocked: "blocked",
  move: "step",
  push: "push",
  goal: "goal-enter",
  "goal-leave": "goal-leave",
  solved: "solve",
};

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

interface SolutionFingerprint {
  readonly puzzleId: string;
  readonly actionLog: string;
}

interface SolutionPlayback {
  readonly active: boolean;
  readonly current: number;
  readonly total: number;
}

const EMPTY_PLAYBACK: SolutionPlayback = Object.freeze({
  active: false,
  current: 0,
  total: 0,
});

export function usePlayController(puzzleId: string, actionLog?: string) {
  const { playCue, reducedMotion } = useExperience();
  const { navigate } = useRouter();
  const [toast, setToast] = useState<string | null>(null);
  const handleSessionRestored = useCallback((moves: number) => {
    setToast(`Restored ${countLabel(moves, "saved move")}.`);
  }, []);
  const {
    session,
    sessionRef,
    progress,
    commitSession,
    recordSolvedSession,
    importProgress,
    resetProgress,
  } = usePersistedPlay(puzzleId, actionLog, handleSessionRestored);
  const [helpOpen, setHelpOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [resetConfirmPuzzleId, setResetConfirmPuzzleId] =
    useState<string | null>(null);
  const [completionPuzzleId, setCompletionPuzzleId] =
    useState<string | null>(null);
  const [completionResult, setCompletionResult] =
    useState<CompletionRecordUpdate>({ newBest: false });
  const [solverPuzzleId, setSolverPuzzleId] = useState<string | null>(null);
  const [optimalCache, setOptimalCache] = useState(loadOptimalCache);
  const [playback, setPlayback] = useState<SolutionPlayback>(EMPTY_PLAYBACK);
  const [deadlockedBoxIds, setDeadlockedBoxIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const playbackRef = useRef<{
    token: number;
    timer?: number;
    active: boolean;
  }>({ token: 0, active: false });
  const resetConfirmOpen = resetConfirmPuzzleId === session.puzzle.id;
  const completionOpen = completionPuzzleId === session.puzzle.id;
  const solverOpen = solverPuzzleId === session.puzzle.id;

  const timerPaused =
    session.solved ||
    completionOpen ||
    resetConfirmOpen ||
    solverOpen ||
    helpOpen ||
    progressOpen ||
    playback.active ||
    session.moves === 0;
  const timer = useTimer({ paused: timerPaused, persistKey: "sokomind:timer" });
  const timerResetRef = useRef(timer.reset);
  useEffect(() => {
    timerResetRef.current = timer.reset;
  }, [timer.reset]);

  const completedIds = useMemo(
    () => new Set(Object.keys(progress.completed)),
    [progress.completed],
  );

  useEffect(() => {
    if (!toast) return;
    const duration = toast.length > 40 ? 3200 : 2200;
    const t = window.setTimeout(() => setToast(null), duration);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => () => {
    playbackRef.current.token += 1;
    if (playbackRef.current.timer !== undefined) {
      window.clearTimeout(playbackRef.current.timer);
    }
  }, []);

  const stopSolutionPlayback = useCallback((announce = false) => {
    const runtime = playbackRef.current;
    const wasActive = runtime.active;
    runtime.token += 1;
    runtime.active = false;
    if (runtime.timer !== undefined) {
      window.clearTimeout(runtime.timer);
      runtime.timer = undefined;
    }
    if (wasActive) {
      setPlayback((current) => ({ ...current, active: false }));
      if (announce) setToast("Solution playback stopped.");
    }
  }, []);

  const applyDirection = useCallback((direction: Direction): boolean => {
    const current = sessionRef.current;
    if (current.solved) return false;

    const next = move(current, direction);
    const feedback = classifyMove(current, next);
    void playCue(FEEDBACK_CUES[feedback]);
    if (feedback === "blocked") {
      setToast("That route is blocked.");
      return false;
    }

    commitSession(next);
    if (feedback === "solved") {
      setDeadlockedBoxIds(new Set());
      setCompletionResult(recordSolvedSession(next));
      setCompletionPuzzleId(next.puzzle.id);
    } else if (feedback === "push" || feedback === "goal" || feedback === "goal-leave") {
      const pushed = findPushedBox(current.snapshot.boxes, next.snapshot.boxes);
      const result = detectDeadlock(next.board, next.snapshot, pushed?.id);
      if (result.isDeadlocked) {
        setDeadlockedBoxIds(new Set(result.deadlockedBoxIds));
        setToast("That box looks stuck — you may need to undo.");
        void playCue("blocked");
      } else {
        setDeadlockedBoxIds(new Set());
      }
    } else {
      setDeadlockedBoxIds(new Set());
    }
    return true;
  }, [commitSession, playCue, recordSolvedSession, sessionRef]);

  const attemptMove = useCallback((direction: Direction) => {
    stopSolutionPlayback();
    applyDirection(direction);
  }, [applyDirection, stopSolutionPlayback]);

  const handleUndo = useCallback(() => {
    stopSolutionPlayback();
    setCompletionPuzzleId(null);
    setDeadlockedBoxIds(new Set());
    const current = sessionRef.current;
    const previous = undo(current);
    if (previous === current) {
      setToast("No move to undo yet.");
      void playCue("blocked");
      return;
    }
    commitSession(previous);
    void playCue("undo");
  }, [commitSession, playCue, sessionRef, stopSolutionPlayback]);

  const performReset = useCallback(() => {
    stopSolutionPlayback();
    setCompletionPuzzleId(null);
    setDeadlockedBoxIds(new Set());
    commitSession(reset(sessionRef.current));
    timerResetRef.current();
    setToast("Room restarted.");
    void playCue("reset");
  }, [commitSession, playCue, sessionRef, stopSolutionPlayback]);

  const requestReset = useCallback(() => {
    if (sessionRef.current.moves === 0) {
      performReset();
    } else {
      setResetConfirmPuzzleId(sessionRef.current.puzzle.id);
    }
  }, [performReset, sessionRef]);

  const selectPuzzle = useCallback((id: string) => {
    stopSolutionPlayback();
    setCompletionPuzzleId(null);
    setDeadlockedBoxIds(new Set());
    setResetConfirmPuzzleId(null);
    setSolverPuzzleId(null);
    timerResetRef.current();
    navigate(playHash(id));
  }, [navigate, stopSolutionPlayback]);

  const selectPreviousPuzzle = useCallback(() => {
    const currentIndex = PUZZLES.findIndex((p) => p.id === session.puzzle.id);
    if (currentIndex > 0) selectPuzzle(PUZZLES[currentIndex - 1].id);
  }, [session.puzzle.id, selectPuzzle]);

  const selectNextPuzzle = useCallback(() => {
    const currentIndex = PUZZLES.findIndex((p) => p.id === session.puzzle.id);
    if (currentIndex < PUZZLES.length - 1) selectPuzzle(PUZZLES[currentIndex + 1].id);
  }, [session.puzzle.id, selectPuzzle]);

  const handleShare = useCallback(async () => {
    const includeRoute = session.actionLog.length <= MAX_SHARED_ACTIONS;
    const url = createShareUrl(
      window.location,
      session.puzzle.id,
      includeRoute && session.actionLog ? session.actionLog : undefined,
    );
    const shareData = {
      title: `${session.puzzle.title} · Sokomind`,
      text: `Try ${session.puzzle.title} in Sokomind.`,
      url,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        setToast("Puzzle shared.");
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setToast(
          includeRoute
            ? "Puzzle and current route copied."
            : "Puzzle link copied; this route is too long to include.",
        );
      } else {
        setToast("Copy the puzzle link from your browser's address bar.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setToast("Could not share automatically. Copy the address from your browser.");
    }
  }, [session.actionLog, session.puzzle.id, session.puzzle.title]);

  const playSolverSolution = useCallback((
    steps: readonly SolutionStep[],
    fingerprint: SolutionFingerprint,
  ) => {
    const current = sessionRef.current;
    if (
      current.puzzle.id !== fingerprint.puzzleId ||
      current.actionLog !== fingerprint.actionLog
    ) {
      setToast("The room changed after this search. Run the solver again.");
      return;
    }

    stopSolutionPlayback();
    setSolverPuzzleId(null);
    if (steps.length === 0) {
      setToast("This room is already solved.");
      return;
    }

    const runtime = playbackRef.current;
    const token = runtime.token + 1;
    runtime.token = token;
    runtime.active = true;
    let expectedActionLog = fingerprint.actionLog;
    setPlayback({ active: true, current: 0, total: steps.length });

    const finish = (currentStep: number, message?: string) => {
      if (playbackRef.current.token !== token) return;
      playbackRef.current.active = false;
      playbackRef.current.timer = undefined;
      setPlayback({
        active: false,
        current: currentStep,
        total: steps.length,
      });
      if (message) setToast(message);
    };

    const advance = (index: number) => {
      if (playbackRef.current.token !== token) return;
      const latest = sessionRef.current;
      if (
        latest.puzzle.id !== fingerprint.puzzleId ||
        latest.actionLog !== expectedActionLog
      ) {
        finish(index, "Playback stopped because the room changed.");
        return;
      }

      if (!applyDirection(steps[index].direction)) {
        finish(index, "Playback stopped on an unexpected blocked move.");
        return;
      }

      expectedActionLog = sessionRef.current.actionLog;
      const completed = index + 1;
      if (completed >= steps.length || sessionRef.current.solved) {
        finish(completed);
        return;
      }

      setPlayback({ active: true, current: completed, total: steps.length });
      playbackRef.current.timer = window.setTimeout(
        () => advance(completed),
        reducedMotion ? 45 : 135,
      );
    };

    runtime.timer = window.setTimeout(
      () => advance(0),
      reducedMotion ? 45 : 180,
    );
  }, [
    applyDirection,
    reducedMotion,
    sessionRef,
    stopSolutionPlayback,
  ]);

  const replaySolution = useCallback(() => {
    const current = sessionRef.current;
    if (!current.solved || current.actionLog.length === 0) return;

    const al = current.actionLog;
    const pid = current.puzzle.id;

    const initial = reset(current);
    commitSession(initial);
    setCompletionPuzzleId(null);
    setDeadlockedBoxIds(new Set());
    timerResetRef.current();

    if (sessionRef.current.moves !== 0) {
      setToast("Reset did not complete — cannot replay.");
      return;
    }

    const directions = decodeActionLog(al);
    const steps: readonly SolutionStep[] = directions.map((d) => ({
      direction: d,
      kind: "walk" as const,
    }));
    const fingerprint = { puzzleId: pid, actionLog: "" };
    playSolverSolution(steps, fingerprint);
  }, [commitSession, playSolverSolution, sessionRef]);

  const handleSaveOptimal = useCallback((
    pid: string,
    record: OptimalRecord,
  ) => {
    setOptimalCache((current) => {
      const next = setOptimalRecord(current, pid, record);
      saveOptimalCache(next);
      return next;
    });
  }, []);

  const hint = useHintController({
    session,
    disabled: playback.active || solverOpen,
    onPlaySteps: playSolverSolution,
    onToast: setToast,
  });

  useGameKeyboard({
    enabled: !playback.active,
    onMove: attemptMove,
    onUndo: handleUndo,
    onReset: requestReset,
    onHint: hint.requestHint,
    onNextPuzzle: selectNextPuzzle,
    onPreviousPuzzle: selectPreviousPuzzle,
  });

  const puzzleIndex = PUZZLES.findIndex((p) => p.id === session.puzzle.id);
  const nextPuzzle = PUZZLES[puzzleIndex + 1];

  return {
    session,
    progress,
    completedIds,
    deadlockedBoxIds,
    elapsed: timer.elapsed,
    hint,
    reducedMotion,
    toast,
    helpOpen,
    progressOpen,
    solverOpen,
    resetConfirmOpen,
    completionOpen,
    completionResult,
    playback,
    attemptMove,
    handleUndo,
    performReset,
    requestReset,
    selectPuzzle,
    importProgress: (imported: ProgressData) => importProgress(imported),
    resetProgress,
    handleShare,
    playSolverSolution,
    replaySolution,
    stopSolutionPlayback: () => stopSolutionPlayback(true),
    openHelp: () => {
      stopSolutionPlayback();
      setHelpOpen(true);
    },
    closeHelp: () => setHelpOpen(false),
    openProgress: () => {
      stopSolutionPlayback();
      setProgressOpen(true);
    },
    closeProgress: () => setProgressOpen(false),
    openSolver: () => {
      stopSolutionPlayback();
      setSolverPuzzleId(session.puzzle.id);
    },
    closeSolver: () => setSolverPuzzleId(null),
    closeResetConfirm: () => setResetConfirmPuzzleId(null),
    closeCompletion: () => setCompletionPuzzleId(null),
    goToPuzzles: () => {
      setCompletionPuzzleId(null);
      navigate(puzzlesHash());
    },
    optimalCache,
    saveOptimalRecord: handleSaveOptimal,
    completionAnnouncement: `${session.puzzle.title} solved in ${countLabel(session.moves, "move")} and ${countLabel(session.pushes, "push")}.`,
    resetMessage: `Restarting removes ${countLabel(session.moves, "move")} in this attempt. Your completed personal best is not affected.`,
    totalPuzzles: PUZZLES.length,
    puzzleIndex,
    nextPuzzle,
  } as const;
}
