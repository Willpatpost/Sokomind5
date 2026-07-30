import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSession,
  replayActionLog,
  type GameSession,
} from "@/src/core";
import { getPuzzleById, PUZZLES } from "@/src/catalog/puzzles";
import {
  EMPTY_PROGRESS,
  loadProgress,
  mergeProgress,
  recordCompletion,
  saveProgress,
  type ProgressData,
  type PuzzleRecord,
} from "@/src/shared/progress";
import {
  loadSession,
  saveSession,
} from "@/src/shared/session-persistence";

export interface CompletionRecordUpdate {
  readonly previousBest?: PuzzleRecord;
  readonly newBest: boolean;
}

function createInitialSession(
  puzzleId: string,
  actionLog?: string,
): GameSession {
  const puzzle = getPuzzleById(puzzleId);
  if (!puzzle) return createSession(PUZZLES[0]);

  if (actionLog) {
    try {
      return replayActionLog(puzzle, actionLog);
    } catch {
      return createSession(puzzle);
    }
  }

  const stored = loadSession(getPuzzleById);
  if (stored && stored.session.puzzle.id === puzzleId) {
    return stored.session;
  }

  return createSession(puzzle);
}

export function usePersistedPlay(
  puzzleId: string,
  actionLog?: string,
  onSessionRestored?: (moves: number) => void,
) {
  const [session, setSession] = useState<GameSession>(() =>
    createInitialSession(puzzleId, actionLog),
  );
  const [progress, setProgress] = useState<ProgressData>(loadProgress);
  const sessionRef = useRef(session);
  const progressRef = useRef(progress);
  const initializedRef = useRef(false);

  const commitSession = useCallback((next: GameSession) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const commitProgress = useCallback((next: ProgressData) => {
    progressRef.current = next;
    setProgress(next);
  }, []);

  useEffect(() => {
    if (initializedRef.current) {
      const next = createInitialSession(puzzleId, actionLog);
      commitSession(next);
    }
    initializedRef.current = true;
  }, [puzzleId, actionLog, commitSession]);

  useEffect(() => {
    const stored = loadSession(getPuzzleById);
    if (
      !actionLog &&
      stored?.resumed &&
      stored.session.puzzle.id === puzzleId &&
      stored.session.actionLog.length > 0
    ) {
      onSessionRestored?.(stored.session.moves);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.title = `${session.puzzle.title} · Sokomind`;
  }, [session.puzzle.title]);

  useEffect(() => {
    saveProgress(progress);
  }, [progress]);

  useEffect(() => {
    saveSession(session);
  }, [session]);

  const recordSolvedSession = useCallback(
    (solved: GameSession): CompletionRecordUpdate => {
      const current = progressRef.current;
      const previousBest = current.completed[solved.puzzle.id];
      const updated = recordCompletion(
        current,
        solved.puzzle.id,
        solved.moves,
        solved.pushes,
      );
      commitProgress(updated);
      return Object.freeze({
        previousBest,
        newBest: updated !== current,
      });
    },
    [commitProgress],
  );

  const importProgress = useCallback((imported: ProgressData) => {
    commitProgress(mergeProgress(progressRef.current, imported));
  }, [commitProgress]);

  const resetProgress = useCallback(() => {
    commitProgress(EMPTY_PROGRESS);
  }, [commitProgress]);

  return {
    session,
    sessionRef,
    progress,
    commitSession,
    recordSolvedSession,
    importProgress,
    resetProgress,
  } as const;
}
