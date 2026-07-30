import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { GameSession, Position } from "@/src/core/model";
import { positionKey } from "@/src/core";
import styles from "./Board.module.css";
import { extractTrailPositions } from "./trail-positions";

interface BoardProps {
  session: GameSession;
  reduceMotion?: boolean;
  deadlockedBoxIds?: ReadonlySet<string>;
}

type BoardStyle = CSSProperties & {
  "--columns": number;
  "--rows": number;
};

type PieceStyle = CSSProperties & {
  "--piece-hue"?: number;
};

interface PieceSlotProps {
  id: string;
  puzzleId: string;
  position: Position;
  reduceMotion: boolean;
  children: ReactNode;
}

function typedHue(label: string): number {
  if (label === "X") return 32;
  return 14 + ((label.charCodeAt(0) - 65) * 47) % 300;
}

function positionLabel(position: Position): string {
  return `row ${position.row + 1}, column ${position.column + 1}`;
}

function PieceSlot({
  id,
  puzzleId,
  position,
  reduceMotion,
  children,
}: PieceSlotProps) {
  const elementRef = useRef<HTMLSpanElement>(null);
  const previousRect = useRef<DOMRect | null>(null);
  const previousPuzzle = useRef(puzzleId);
  const animation = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const nextRect = element.getBoundingClientRect();
    const previous = previousRect.current;

    if (
      previous &&
      previousPuzzle.current === puzzleId &&
      !reduceMotion
    ) {
      const x = previous.left - nextRect.left;
      const y = previous.top - nextRect.top;

      if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) {
        animation.current?.cancel();
        animation.current = element.animate(
          [
            { transform: `translate3d(${x}px, ${y}px, 0)` },
            { transform: "translate3d(0, 0, 0)" },
          ],
          {
            duration: 190,
            easing: "cubic-bezier(0.2, 0.8, 0.3, 1)",
          },
        );
      }
    }

    previousRect.current = nextRect;
    previousPuzzle.current = puzzleId;
  }, [position.column, position.row, puzzleId, reduceMotion]);

  useLayoutEffect(
    () => () => {
      animation.current?.cancel();
    },
    [],
  );

  return (
    <span
      className={styles.pieceSlot}
      data-piece-id={id}
      ref={elementRef}
      style={{
        gridColumn: position.column + 1,
        gridRow: position.row + 1,
      }}
    >
      {children}
    </span>
  );
}

const EMPTY_SET = new Set<string>();

export const Board = memo(function Board({
  session,
  reduceMotion = false,
  deadlockedBoxIds = EMPTY_SET,
}: BoardProps) {
  const { board, snapshot, puzzle } = session;
  const { cells, goals, walls } = useMemo(
    () => ({
      walls: new Set(board.walls.map(positionKey)),
      goals: new Map(
        board.goals.map((goal) => [positionKey(goal.position), goal]),
      ),
      cells: Array.from(
        { length: board.width * board.height },
        (_, index) => ({
          row: Math.floor(index / board.width),
          column: index % board.width,
        }),
      ),
    }),
    [board],
  );
  const trailPositions = useMemo(
    () => extractTrailPositions(session.history.head, snapshot.robot),
    [session.history.head, snapshot.robot],
  );

  const matchedBoxes = snapshot.boxes.filter(
    (box) => goals.get(positionKey(box.position))?.label === box.label,
  ).length;
  const boardSummary = [
    `${puzzle.title} puzzle board, ${board.width} columns by ${board.height} rows.`,
    `Keeper at ${positionLabel(snapshot.robot)}.`,
    `${matchedBoxes} of ${snapshot.boxes.length} boxes on matching goals.`,
    `${snapshot.moves} ${snapshot.moves === 1 ? "move" : "moves"} and ${snapshot.pushes} ${snapshot.pushes === 1 ? "push" : "pushes"}.`,
  ].join(" ");

  const style: BoardStyle = {
    "--columns": board.width,
    "--rows": board.height,
    maxWidth: `${board.width * 44}px`,
  };

  return (
    <div
      className={styles.board}
      style={style}
      role="img"
      aria-label={boardSummary}
      data-solved={snapshot.solved || undefined}
      data-testid="game-board"
    >
      {cells.map((position) => {
        const key = positionKey(position);
        const wall = walls.has(key);
        const goal = goals.get(key);

        return (
          <div
            className={`${styles.cell} ${wall ? styles.wall : styles.floor}`}
            aria-hidden="true"
            key={key}
          >
            {!wall && goal ? (
              <span
                className={styles.goal}
                data-generic={goal.label === "X" || undefined}
                style={{ "--piece-hue": typedHue(goal.label) } as PieceStyle}
                aria-hidden="true"
              >
                <span>{goal.label === "X" ? "" : goal.label}</span>
              </span>
            ) : null}
          </div>
        );
      })}

      {!reduceMotion && trailPositions.length > 0 ? (
        <div className={styles.trailLayer} aria-hidden="true">
          {trailPositions.map((trail) => (
            <span
              key={`trail-${trail.age}`}
              className={styles.trailMarker}
              style={
                {
                  gridColumn: trail.position.column + 1,
                  gridRow: trail.position.row + 1,
                  "--trail-age": trail.age,
                } as CSSProperties
              }
            />
          ))}
        </div>
      ) : null}

      <div className={styles.pieceLayer} aria-hidden="true">
        {snapshot.boxes.map((box) => {
          const goal = goals.get(positionKey(box.position));
          const boxOnGoal = goal?.label === box.label;

          return (
            <PieceSlot
              id={box.id}
              key={box.id}
              puzzleId={puzzle.id}
              position={box.position}
              reduceMotion={reduceMotion}
            >
              <span
                className={styles.box}
                data-generic={box.label === "X" || undefined}
                data-home={boxOnGoal || undefined}
                data-deadlocked={deadlockedBoxIds.has(box.id) || undefined}
                style={{ "--piece-hue": typedHue(box.label) } as PieceStyle}
              >
                <span className={styles.crateFace}>
                  <span className={styles.sigil}>
                    {box.label === "X" ? "" : box.label}
                  </span>
                </span>
              </span>
            </PieceSlot>
          );
        })}

        <PieceSlot
          id="keeper"
          puzzleId={puzzle.id}
          position={snapshot.robot}
          reduceMotion={reduceMotion}
        >
          <span className={styles.robot}>
            <span className={styles.antenna} />
            <span className={styles.robotFace} />
          </span>
        </PieceSlot>
      </div>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {snapshot.moves > 0 ? boardSummary : ""}
      </span>
    </div>
  );
});
