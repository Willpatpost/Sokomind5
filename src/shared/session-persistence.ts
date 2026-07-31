import {
  createSession,
  isActionLog,
  replayActionLog,
  type GameSession,
  type PuzzleDefinition,
} from "../core/index.ts";
import {
  LEGACY_STORAGE_KEYS,
  STORAGE_KEYS,
  readStoredValue,
  removeStoredValue,
  writeStoredValue,
} from "./storage.ts";

export const SAVED_SESSION_VERSION = 1 as const;
export const MAX_SAVED_ACTIONS = 100_000;

export interface SavedSession {
  readonly version: typeof SAVED_SESSION_VERSION;
  readonly puzzleId: string;
  readonly actionLog: string;
  readonly updatedAt: string;
}

export interface RestoredSession {
  readonly session: GameSession;
  readonly resumed: boolean;
}

export type PuzzleResolver = (
  puzzleId: string,
) => PuzzleDefinition | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function parseSavedSession(serialized: string | null): SavedSession | null {
  if (!serialized) return null;

  try {
    const value: unknown = JSON.parse(serialized);
    if (
      !isRecord(value) ||
      value.version !== SAVED_SESSION_VERSION ||
      typeof value.puzzleId !== "string" ||
      value.puzzleId.length === 0 ||
      value.puzzleId.length > 100 ||
      !isActionLog(value.actionLog) ||
      value.actionLog.length > MAX_SAVED_ACTIONS ||
      typeof value.updatedAt !== "string"
    ) {
      return null;
    }

    return Object.freeze({
      version: SAVED_SESSION_VERSION,
      puzzleId: value.puzzleId,
      actionLog: value.actionLog,
      updatedAt: value.updatedAt,
    });
  } catch {
    return null;
  }
}

export function restoreSession(
  saved: SavedSession,
  resolvePuzzle: PuzzleResolver,
): GameSession | null {
  const puzzle = resolvePuzzle(saved.puzzleId);
  if (!puzzle) return null;

  try {
    return replayActionLog(puzzle, saved.actionLog);
  } catch {
    // Stored moves are untrusted. Invalid or newly-incompatible attempts are
    // ignored instead of constructing a state the game engine cannot reach.
    return null;
  }
}

export function loadSession(
  resolvePuzzle: PuzzleResolver,
): RestoredSession | null {
  const stored = parseSavedSession(readStoredValue(STORAGE_KEYS.session));
  if (stored) {
    const session = restoreSession(stored, resolvePuzzle);
    if (session) {
      return Object.freeze({
        session,
        resumed: session.actionLog.length > 0,
      });
    }
  }

  // One-time compatibility with the earlier Sokomind prototype, which saved
  // only the current puzzle id under the unnamespaced key.
  const legacyPuzzleId = readStoredValue(LEGACY_STORAGE_KEYS.currentPuzzle);
  const legacyPuzzle = legacyPuzzleId
    ? resolvePuzzle(legacyPuzzleId)
    : undefined;
  if (!legacyPuzzle) return null;

  return Object.freeze({
    session: createSession(legacyPuzzle),
    resumed: false,
  });
}

export function saveSession(session: GameSession): boolean {
  const saved: SavedSession = {
    version: SAVED_SESSION_VERSION,
    puzzleId: session.puzzle.id,
    actionLog: session.actionLog,
    updatedAt: new Date().toISOString(),
  };
  return writeStoredValue(STORAGE_KEYS.session, JSON.stringify(saved));
}

export function clearSession(): boolean {
  return removeStoredValue(STORAGE_KEYS.session);
}
