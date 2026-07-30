import type {
  Box,
  Direction,
  GameAction,
  GameHistory,
  GameHistoryEntry,
  GameSession,
  GameSnapshot,
  ParsedBoard,
  Position,
  PuzzleDefinition,
  SnapshotTransition,
} from "./model.ts";
import { encodeDirection } from "./action-log.ts";
import { parsePuzzle } from "./puzzle.ts";
import {
  directionDelta,
  freezePosition,
  positionKey,
  translate,
} from "./position.ts";

function clonePuzzle(puzzle: PuzzleDefinition): PuzzleDefinition {
  return Object.freeze({
    id: puzzle.id,
    title: puzzle.title,
    difficulty: puzzle.difficulty,
    boxes: puzzle.boxes,
    ...(puzzle.hint === undefined ? {} : { hint: puzzle.hint }),
    ...(puzzle.collection === undefined
      ? {}
      : { collection: puzzle.collection }),
    rows: Object.freeze([...puzzle.rows]),
  });
}

function freezeBox(box: Box): Box {
  return Object.freeze({
    id: box.id,
    label: box.label,
    position: freezePosition(box.position),
  });
}

function boxesAreSolved(board: ParsedBoard, boxes: readonly Box[]): boolean {
  const goals = new Map(
    board.goals.map((goal) => [positionKey(goal.position), goal.label]),
  );
  return boxes.every(
    (box) => goals.get(positionKey(box.position)) === box.label,
  );
}

function createSnapshot(
  puzzleId: string,
  board: ParsedBoard,
  robot: Position,
  boxes: readonly Box[],
  moves: number,
  pushes: number,
): GameSnapshot {
  const frozenBoxes = Object.isFrozen(boxes)
    ? boxes
    : Object.freeze(boxes.map(freezeBox));

  return Object.freeze({
    puzzleId,
    robot: freezePosition(robot),
    boxes: frozenBoxes,
    moves,
    pushes,
    solved: boxesAreSolved(board, frozenBoxes),
  });
}

function createSessionValue(
  puzzle: PuzzleDefinition,
  board: ParsedBoard,
  snapshot: GameSnapshot,
  history: GameHistory,
  actionLog: string,
): GameSession {
  return Object.freeze({
    puzzle,
    board,
    snapshot,
    history,
    actionLog,
    moves: snapshot.moves,
    pushes: snapshot.pushes,
    solved: snapshot.solved,
  });
}

const EMPTY_HISTORY: GameHistory = Object.freeze({
  head: null,
  length: 0,
});

function pushHistory(
  history: GameHistory,
  snapshot: GameSnapshot,
): GameHistory {
  const head: GameHistoryEntry = Object.freeze({
    snapshot,
    previous: history.head,
  });
  return Object.freeze({
    head,
    length: history.length + 1,
  });
}

function popHistory(history: GameHistory): GameHistory {
  if (!history.head) return history;
  if (history.length === 1) return EMPTY_HISTORY;
  return Object.freeze({
    head: history.head.previous,
    length: history.length - 1,
  });
}

function isFloor(board: ParsedBoard, position: Position): boolean {
  if (
    position.row < 0 ||
    position.column < 0 ||
    position.row >= board.height ||
    position.column >= board.width
  ) {
    return false;
  }
  return board.rows[position.row]?.[position.column] !== "O";
}

export function createSession(puzzleDefinition: PuzzleDefinition): GameSession {
  const puzzle = clonePuzzle(puzzleDefinition);
  const board = parsePuzzle(puzzle);
  const snapshot = createSnapshot(
    puzzle.id,
    board,
    board.initialRobot,
    board.initialBoxes,
    0,
    0,
  );
  return createSessionValue(puzzle, board, snapshot, EMPTY_HISTORY, "");
}

/**
 * Apply one direction to a snapshot without creating session history.
 *
 * Successful pushes leave the robot on the box's former cell, which is the
 * exact post-push position required by future deadlock and corral analysis.
 */
export function stepSnapshot(
  board: ParsedBoard,
  snapshot: GameSnapshot,
  direction: Direction,
): SnapshotTransition {
  const delta = directionDelta(direction);
  const destination = translate(snapshot.robot, delta);
  if (!isFloor(board, destination)) {
    return Object.freeze({ snapshot, moved: false, pushed: false });
  }

  const pushedBoxIndex = snapshot.boxes.findIndex(
    (box) => positionKey(box.position) === positionKey(destination),
  );
  let boxes = snapshot.boxes;
  let pushes = snapshot.pushes;
  let pushed = false;

  if (pushedBoxIndex >= 0) {
    const boxDestination = translate(destination, delta);
    const occupied = snapshot.boxes.some(
      (box) => positionKey(box.position) === positionKey(boxDestination),
    );
    if (!isFloor(board, boxDestination) || occupied) {
      return Object.freeze({ snapshot, moved: false, pushed: false });
    }

    boxes = Object.freeze(
      snapshot.boxes.map((box, index) =>
        index === pushedBoxIndex
          ? freezeBox({ ...box, position: boxDestination })
          : box,
      ),
    );
    pushes += 1;
    pushed = true;
  }

  const nextSnapshot = createSnapshot(
    snapshot.puzzleId,
    board,
    destination,
    boxes,
    snapshot.moves + 1,
    pushes,
  );
  return Object.freeze({
    snapshot: nextSnapshot,
    moved: true,
    pushed,
  });
}

/**
 * Apply one player step. Blocked steps are no-ops and return the same session.
 */
export function move(session: GameSession, direction: Direction): GameSession {
  const transition = stepSnapshot(session.board, session.snapshot, direction);
  if (!transition.moved) return session;

  return createSessionValue(
    session.puzzle,
    session.board,
    transition.snapshot,
    pushHistory(session.history, session.snapshot),
    `${session.actionLog}${encodeDirection(direction)}`,
  );
}

export function undo(session: GameSession): GameSession {
  const previous = session.history.head;
  if (!previous) return session;
  return createSessionValue(
    session.puzzle,
    session.board,
    previous.snapshot,
    popHistory(session.history),
    session.actionLog.slice(0, -1),
  );
}

export function reset(session: GameSession): GameSession {
  const snapshot = createSnapshot(
    session.puzzle.id,
    session.board,
    session.board.initialRobot,
    session.board.initialBoxes,
    0,
    0,
  );
  return createSessionValue(
    session.puzzle,
    session.board,
    snapshot,
    EMPTY_HISTORY,
    "",
  );
}

/** Selector kept explicit so UI and solver consumers need not inspect fields. */
export function isSolved(snapshot: GameSnapshot): boolean {
  return snapshot.solved;
}

export function sessionReducer(
  session: GameSession,
  action: GameAction,
): GameSession {
  switch (action.type) {
    case "move":
      return move(session, action.direction);
    case "undo":
      return undo(session);
    case "reset":
      return reset(session);
  }
}
