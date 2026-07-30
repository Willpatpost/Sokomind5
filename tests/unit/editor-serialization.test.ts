import assert from "node:assert/strict";
import test from "node:test";

import {
  encodePuzzleUrl,
  decodeCustomPuzzle,
} from "../../src/features/editor/editor-serialization.ts";

import type { PuzzleDefinition } from "../../src/core/model.ts";

const SAMPLE_PUZZLE: PuzzleDefinition = {
  id: "test-1",
  title: "Test Room",
  difficulty: "beginner",
  boxes: 1,
  hint: "Push the box onto the goal.",
  rows: [
    "OOOOO",
    "O R O",
    "O X O",
    "O S O",
    "OOOOO",
  ],
};

test("round-trip encode then decode preserves puzzle data", () => {
  const hash = encodePuzzleUrl(SAMPLE_PUZZLE);
  const decoded = decodeCustomPuzzle(hash);
  assert.ok(decoded);
  assert.equal(decoded.title, SAMPLE_PUZZLE.title);
  assert.equal(decoded.difficulty, SAMPLE_PUZZLE.difficulty);
  assert.equal(decoded.hint, SAMPLE_PUZZLE.hint);
  assert.deepEqual(decoded.rows, SAMPLE_PUZZLE.rows);
  assert.equal(decoded.boxes, 1);
});

test("encode produces #custom= prefix", () => {
  const hash = encodePuzzleUrl(SAMPLE_PUZZLE);
  assert.ok(hash.startsWith("#custom="));
});

test("decode returns null for non-custom hash", () => {
  assert.equal(decodeCustomPuzzle("#puzzle=foo"), null);
});

test("decode returns null for invalid base64", () => {
  assert.equal(decodeCustomPuzzle("#custom=!!!invalid!!!"), null);
});

test("decode returns null for invalid JSON structure", () => {
  const encoded = btoa("not json");
  assert.equal(decodeCustomPuzzle(`#custom=${encoded}`), null);
});

test("decode returns null for missing title", () => {
  const encoded = btoa(JSON.stringify({ d: "beginner", r: ["OOO", "ORO", "OOO"] }));
  assert.equal(decodeCustomPuzzle(`#custom=${encoded}`), null);
});

test("decode returns null for invalid difficulty", () => {
  const encoded = btoa(JSON.stringify({ t: "X", d: "impossible", r: ["OOO", "ORO", "OOO"] }));
  assert.equal(decodeCustomPuzzle(`#custom=${encoded}`), null);
});

test("decode returns null for too few rows", () => {
  const encoded = btoa(JSON.stringify({ t: "X", d: "beginner", r: ["OO"] }));
  assert.equal(decodeCustomPuzzle(`#custom=${encoded}`), null);
});

test("puzzle without hint omits hint in encoding", () => {
  const noHint: PuzzleDefinition = { ...SAMPLE_PUZZLE, hint: undefined };
  const hash = encodePuzzleUrl(noHint);
  const decoded = decodeCustomPuzzle(hash);
  assert.ok(decoded);
  assert.equal(decoded.hint, undefined);
});

test("unicode title survives round-trip", () => {
  const unicode: PuzzleDefinition = { ...SAMPLE_PUZZLE, title: "Rätsel Nö. 1" };
  const hash = encodePuzzleUrl(unicode);
  const decoded = decodeCustomPuzzle(hash);
  assert.ok(decoded);
  assert.equal(decoded.title, "Rätsel Nö. 1");
});

test("decoded puzzle gets a custom- prefixed id", () => {
  const hash = encodePuzzleUrl(SAMPLE_PUZZLE);
  const decoded = decodeCustomPuzzle(hash);
  assert.ok(decoded);
  assert.ok(decoded.id.startsWith("custom-"));
});

test("box count is computed from rows", () => {
  const multi: PuzzleDefinition = {
    ...SAMPLE_PUZZLE,
    boxes: 3,
    rows: [
      "OOOOOOO",
      "O R   O",
      "O X A O",
      "O B s O",
      "O S a O",
      "O   b O",
      "OOOOOOO",
    ],
  };
  const hash = encodePuzzleUrl(multi);
  const decoded = decodeCustomPuzzle(hash);
  assert.ok(decoded);
  assert.equal(decoded.boxes, 3);
});
