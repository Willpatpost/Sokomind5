import { EDITOR_TOOLS, type EditorAction } from "./editor-model";
import styles from "./EditorToolbar.module.css";

interface EditorToolbarProps {
  readonly selectedTool: string;
  readonly dispatch: (action: EditorAction) => void;
}

const GROUPS = [
  { key: "terrain", label: "Terrain" },
  { key: "pieces", label: "Pieces" },
  { key: "labeled", label: "Labeled pairs" },
] as const;

export function EditorToolbar({
  selectedTool,
  dispatch,
}: EditorToolbarProps) {
  return (
    <div className={styles.toolbar}>
      {GROUPS.map((group) => (
        <div key={group.key} className={styles.group}>
          <p className={styles.groupLabel}>{group.label}</p>
          <div className={styles.tools}>
            {EDITOR_TOOLS.filter((t) => t.group === group.key).map((tool) => (
              <button
                key={tool.symbol}
                className={styles.tool}
                type="button"
                data-active={selectedTool === tool.symbol || undefined}
                title={tool.label}
                onClick={() =>
                  dispatch({ type: "set-tool", tool: tool.symbol })
                }
              >
                {tool.symbol === " " ? "·" : tool.symbol}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
