import assert from "node:assert/strict";
import test from "node:test";

import {
  TYPED_LABELS,
  createInitialState,
  editorReducer,
  stateToPuzzle,
  validateEditorState,
} from "../../src/features/editor/editor-model.ts";
import { validatePuzzle } from "../../src/core/puzzle.ts";

test("initial state creates a 7x7 grid of walls", () => {
  const state = createInitialState();
  assert.equal(state.width, 7);
  assert.equal(state.height, 7);
  assert.equal(state.cells.length, 7);
  assert.equal(state.cells[0].length, 7);
  assert.ok(state.cells.every((row) => row.every((cell) => cell === "O")));
});

test("set-cell places the selected tool", () => {
  let state = createInitialState();
  state = editorReducer(state, { type: "set-tool", tool: " " });
  state = editorReducer(state, { type: "set-cell", row: 1, column: 1 });
  assert.equal(state.cells[1][1], " ");
});

test("placing a robot removes existing robot", () => {
  let state = createInitialState();
  state = editorReducer(state, { type: "set-tool", tool: "R" });
  state = editorReducer(state, { type: "set-cell", row: 1, column: 1 });
  assert.equal(state.cells[1][1], "R");
  state = editorReducer(state, { type: "set-cell", row: 2, column: 2 });
  assert.equal(state.cells[2][2], "R");
  assert.equal(state.cells[1][1], " ");
});

test("resize preserves existing cells in bounds", () => {
  let state = createInitialState();
  state = editorReducer(state, { type: "set-tool", tool: " " });
  state = editorReducer(state, { type: "set-cell", row: 0, column: 0 });
  assert.equal(state.cells[0][0], " ");
  state = editorReducer(state, { type: "resize", width: 5, height: 5 });
  assert.equal(state.width, 5);
  assert.equal(state.height, 5);
  assert.equal(state.cells[0][0], " ");
});

test("resize fills new area with walls", () => {
  let state = createInitialState();
  state = editorReducer(state, { type: "resize", width: 9, height: 9 });
  assert.equal(state.cells[8][8], "O");
});

test("resize clamps to min/max", () => {
  let state = createInitialState();
  state = editorReducer(state, { type: "resize", width: 1, height: 1 });
  assert.equal(state.width, 3);
  assert.equal(state.height, 3);
  state = editorReducer(state, { type: "resize", width: 50, height: 50 });
  assert.equal(state.width, 20);
  assert.equal(state.height, 20);
});

test("clear fills all cells with walls", () => {
  let state = createInitialState();
  state = editorReducer(state, { type: "set-tool", tool: " " });
  state = editorReducer(state, { type: "set-cell", row: 1, column: 1 });
  state = editorReducer(state, { type: "clear" });
  assert.ok(state.cells.every((row) => row.every((cell) => cell === "O")));
});

test("validates missing robot and boxes", () => {
  const state = createInitialState();
  const result = validateEditorState(state);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("robot")));
  assert.ok(result.errors.some((e) => e.includes("box")));
});

test("validates generic box/goal mismatch", () => {
  let state = createInitialState();
  state = editorReducer(state, { type: "set-tool", tool: "R" });
  state = editorReducer(state, { type: "set-cell", row: 1, column: 1 });
  state = editorReducer(state, { type: "set-tool", tool: "X" });
  state = editorReducer(state, { type: "set-cell", row: 2, column: 2 });
  const result = validateEditorState(state);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("mismatch")));
});

test("valid puzzle passes validation", () => {
  let state = createInitialState();
  state = editorReducer(state, { type: "set-tool", tool: " " });
  state = editorReducer(state, { type: "set-cell", row: 1, column: 1 });
  state = editorReducer(state, { type: "set-cell", row: 1, column: 2 });
  state = editorReducer(state, { type: "set-cell", row: 1, column: 3 });
  state = editorReducer(state, { type: "set-cell", row: 2, column: 1 });
  state = editorReducer(state, { type: "set-cell", row: 2, column: 2 });
  state = editorReducer(state, { type: "set-cell", row: 2, column: 3 });
  state = editorReducer(state, { type: "set-tool", tool: "R" });
  state = editorReducer(state, { type: "set-cell", row: 1, column: 1 });
  state = editorReducer(state, { type: "set-tool", tool: "X" });
  state = editorReducer(state, { type: "set-cell", row: 1, column: 2 });
  state = editorReducer(state, { type: "set-tool", tool: "S" });
  state = editorReducer(state, { type: "set-cell", row: 1, column: 3 });
  const result = validateEditorState(state);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("offers every legal typed label and excludes reserved symbols", () => {
  assert.equal(TYPED_LABELS.length, 22);
  assert.equal(new Set(TYPED_LABELS).size, 22);
  assert.ok(TYPED_LABELS.includes("A"));
  assert.ok(TYPED_LABELS.includes("Z"));
  for (const reserved of ["O", "R", "S", "X"]) {
    assert.equal(
      (TYPED_LABELS as readonly string[]).includes(reserved),
      false,
    );
  }
});

test("supports a matching Z typed box and goal through core validation", () => {
  let state = createInitialState();
  state = editorReducer(state, {
    type: "load",
    puzzle: {
      id: "typed-z",
      title: "Typed Z",
      difficulty: "beginner",
      boxes: 1,
      rows: ["OOOOO", "O R O", "O Z O", "O z O", "OOOOO"],
    },
  });

  assert.deepEqual(validateEditorState(state), { valid: true, errors: [] });
  assert.equal(validatePuzzle(stateToPuzzle(state)).valid, true);
});
