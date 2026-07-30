import {
  ActionLogError,
  decodeActionLog,
  encodeDirection,
} from "./action-log.ts";
import { createSession, move } from "./game-session.ts";
import type { GameSession, PuzzleDefinition } from "./model.ts";

/**
 * Rebuild a session from a compact action log using the same transition rules
 * as live play. Any blocked step marks the stored log as corrupt.
 */
export function replayActionLog(
  puzzle: PuzzleDefinition,
  actionLog: unknown,
): GameSession {
  const directions = decodeActionLog(actionLog);
  let session = createSession(puzzle);

  for (let index = 0; index < directions.length; index += 1) {
    const direction = directions[index];
    if (!direction) continue;

    const next = move(session, direction);
    if (next === session) {
      const action = encodeDirection(direction);
      throw new ActionLogError(
        "blocked-action",
        `Action ${action} at index ${index} is blocked in puzzle ${JSON.stringify(puzzle.id)}.`,
        { index, action },
      );
    }
    session = next;
  }

  return session;
}
