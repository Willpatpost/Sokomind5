import { useCallback, useRef } from "react";
import type { EditorAction, EditorState } from "./editor-model";
import styles from "./EditorGrid.module.css";

interface EditorGridProps {
  readonly state: EditorState;
  readonly dispatch: (action: EditorAction) => void;
}

function cellLabel(symbol: string): string {
  if (symbol === "O") return "W";
  if (symbol === " ") return "";
  if (symbol === "S") return "G";
  return symbol;
}

function isLabeledBox(symbol: string): boolean {
  return /^[A-Z]$/.test(symbol) && !"ORSX".includes(symbol);
}

function isLabeledGoal(symbol: string): boolean {
  return /^[a-z]$/.test(symbol);
}

export function EditorGrid({ state, dispatch }: EditorGridProps) {
  const painting = useRef(false);

  const paint = useCallback(
    (row: number, column: number) => {
      dispatch({ type: "set-cell", row, column });
    },
    [dispatch],
  );

  return (
    <div
      className={styles.grid}
      style={{
        gridTemplateColumns: `repeat(${state.width}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${state.height}, minmax(0, 1fr))`,
      }}
      onPointerDown={() => { painting.current = true; }}
      onPointerUp={() => { painting.current = false; }}
      onPointerLeave={() => { painting.current = false; }}
    >
      {state.cells.flatMap((row, r) =>
        row.map((symbol, c) => (
          <button
            key={`${r}-${c}`}
            className={styles.cell}
            data-symbol={symbol}
            data-labeled-box={isLabeledBox(symbol) || undefined}
            data-labeled-goal={isLabeledGoal(symbol) || undefined}
            type="button"
            onPointerDown={() => paint(r, c)}
            onPointerEnter={() => {
              if (painting.current) paint(r, c);
            }}
          >
            {cellLabel(symbol)}
          </button>
        )),
      )}
    </div>
  );
}
