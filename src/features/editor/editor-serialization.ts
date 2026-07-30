import type { Difficulty, PuzzleDefinition } from "../../core/model.ts";
import { DIFFICULTIES } from "../../core/model.ts";

interface CompactPuzzle {
  t: string;
  d: string;
  h?: string;
  r: string[];
}

export function encodePuzzleUrl(puzzle: PuzzleDefinition): string {
  const compact: CompactPuzzle = {
    t: puzzle.title,
    d: puzzle.difficulty,
    r: [...puzzle.rows],
  };
  if (puzzle.hint) compact.h = puzzle.hint;
  const json = JSON.stringify(compact);
  const encoded = btoa(unescape(encodeURIComponent(json)));
  return `#custom=${encoded}`;
}

export function decodeCustomPuzzle(hash: string): PuzzleDefinition | null {
  const serialized = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(serialized);
  const encoded = params.get("custom");
  if (!encoded) return null;

  try {
    const json = decodeURIComponent(escape(atob(encoded)));
    const compact = JSON.parse(json) as unknown;
    if (typeof compact !== "object" || compact === null) return null;

    const c = compact as Record<string, unknown>;
    if (typeof c.t !== "string" || !c.t.trim()) return null;
    if (typeof c.d !== "string" || !(DIFFICULTIES as readonly string[]).includes(c.d)) return null;
    if (!Array.isArray(c.r) || c.r.length < 3 || c.r.length > 20) return null;

    const rows = c.r as unknown[];
    for (const row of rows) {
      if (typeof row !== "string") return null;
      if ([...row].length > 20) return null;
    }

    const puzzleRows = rows as string[];
    let boxes = 0;
    for (const row of puzzleRows) {
      for (const ch of row) {
        if (ch === "X" || (/^[A-Z]$/.test(ch) && !"ORSX".includes(ch))) {
          boxes++;
        }
      }
    }

    return {
      id: `custom-${Date.now()}`,
      title: c.t,
      difficulty: c.d as Difficulty,
      boxes,
      hint: typeof c.h === "string" ? c.h : undefined,
      rows: puzzleRows,
    };
  } catch {
    return null;
  }
}
