import type {
  Box,
} from "../../core/model.ts";
import type {
  CompiledSearchBoard,
} from "./compiled-board.ts";

/** Dynamic box data in the dense coordinate system used by search. */
export interface DenseBox {
  readonly id: string;
  readonly label: string;
  readonly cell: number;
}

/** Convert JSON-safe core boxes into deterministic dense search values. */
export function toDenseBoxes(
  board: CompiledSearchBoard,
  boxes: readonly Box[],
): readonly DenseBox[] {
  const denseBoxes = boxes.map((box) => {
    const cell = board.cellAt(box.position.row, box.position.column);
    if (cell < 0) {
      throw new RangeError(
        `Box ${JSON.stringify(box.id)} is not on a floor cell.`,
      );
    }
    return Object.freeze({
      id: box.id,
      label: box.label,
      cell,
    });
  });
  return Object.freeze(denseBoxes);
}

/**
 * Canonical box-only identity.
 *
 * Stable box ids are deliberately excluded: boxes carrying the same label are
 * interchangeable for both solving and assignment. Labels and cells are
 * length-delimited so the signature remains unambiguous.
 *
 * IMPORTANT: This function assumes `boxes` is already sorted by
 * `label.localeCompare` then `cell` ascending (the order produced by
 * `sortedBoxes()` in engine.ts). All callers in the search loop pass boxes
 * that went through `movedBoxes()` -> `sortedBoxes()`, and the heuristic
 * cache receives boxes from search nodes which were also created that way.
 * If a future caller passes unsorted boxes, the signature will be wrong.
 */
export function canonicalBoxSignature(
  boxes: readonly DenseBox[],
): string {
  if (boxes.length === 0) return "";
  let result = "";
  let i = 0;
  while (i < boxes.length) {
    const label = boxes[i].label;
    if (result) result += "|";
    result += `${label.length}:${label}:${boxes[i].cell}`;
    i += 1;
    while (i < boxes.length && boxes[i].label === label) {
      result += `.${boxes[i].cell}`;
      i += 1;
    }
  }
  return result;
}
