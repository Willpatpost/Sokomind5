import assert from "node:assert/strict";
import test from "node:test";

import {
  createRng,
  floodFill,
  generateFloorLayout,
  generateBoardTemplate,
} from "../../src/features/generator/board-template.ts";
import {
  canRobotReach,
  enumerateReversePulls,
  scrambleByReversePull,
} from "../../src/features/generator/reverse-play.ts";
import {
  classifyFromMetrics,
} from "../../src/features/generator/difficulty-classifier.ts";
import {
  buildPuzzleFromScramble,
} from "../../src/features/generator/generate-puzzle.ts";
import {
  VALID_LABELS,
} from "../../src/features/generator/label-assignment.ts";
import { validatePuzzle } from "../../src/core/puzzle.ts";

// ---------------------------------------------------------------------------
// PRNG
// ---------------------------------------------------------------------------

test("createRng: same seed produces same sequence", () => {
  const a = createRng(42);
  const b = createRng(42);
  for (let i = 0; i < 20; i++) {
    assert.equal(a(), b());
  }
});

test("createRng: different seeds produce different sequences", () => {
  const a = createRng(1);
  const b = createRng(2);
  let differ = false;
  for (let i = 0; i < 10; i++) {
    if (a() !== b()) {
      differ = true;
      break;
    }
  }
  assert.ok(differ);
});

test("createRng: values are in [0, 1)", () => {
  const rng = createRng(123);
  for (let i = 0; i < 100; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1, `value ${v} not in [0,1)`);
  }
});

// ---------------------------------------------------------------------------
// floodFill
// ---------------------------------------------------------------------------

test("floodFill: connected room returns all floor cells", () => {
  const grid = [
    ["O", "O", "O", "O"],
    ["O", " ", " ", "O"],
    ["O", " ", " ", "O"],
    ["O", "O", "O", "O"],
  ];
  const result = floodFill(grid, { row: 1, column: 1 });
  assert.equal(result.size, 4);
  assert.ok(result.has("1,1"));
  assert.ok(result.has("1,2"));
  assert.ok(result.has("2,1"));
  assert.ok(result.has("2,2"));
});

test("floodFill: disconnected rooms return only the starting component", () => {
  const grid = [
    ["O", "O", "O", "O", "O"],
    ["O", " ", "O", " ", "O"],
    ["O", " ", "O", " ", "O"],
    ["O", "O", "O", "O", "O"],
  ];
  const left = floodFill(grid, { row: 1, column: 1 });
  assert.equal(left.size, 2);
  assert.ok(left.has("1,1"));
  assert.ok(left.has("2,1"));
  assert.ok(!left.has("1,3"));
});

test("floodFill: starting on a wall returns empty set", () => {
  const grid = [
    ["O", "O"],
    ["O", " "],
  ];
  const result = floodFill(grid, { row: 0, column: 0 });
  assert.equal(result.size, 0);
});

// ---------------------------------------------------------------------------
// generateFloorLayout
// ---------------------------------------------------------------------------

test("generateFloorLayout: border cells are all walls", () => {
  const rng = createRng(100);
  const grid = generateFloorLayout(8, 8, 11, rng);
  for (let c = 0; c < 8; c++) {
    assert.equal(grid[0][c], "O", `top border [0,${c}]`);
    assert.equal(grid[7][c], "O", `bottom border [7,${c}]`);
  }
  for (let r = 0; r < 8; r++) {
    assert.equal(grid[r][0], "O", `left border [${r},0]`);
    assert.equal(grid[r][7], "O", `right border [${r},7]`);
  }
});

test("generateFloorLayout: floor count meets minimum", () => {
  const rng = createRng(200);
  const minFloor = 11;
  const grid = generateFloorLayout(8, 8, minFloor, rng);
  let floorCount = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (cell !== "O") floorCount++;
    }
  }
  assert.ok(floorCount >= minFloor, `floor count ${floorCount} < ${minFloor}`);
});

test("generateFloorLayout: floor is fully connected", () => {
  const rng = createRng(300);
  const grid = generateFloorLayout(9, 9, 14, rng);
  let firstFloor: { row: number; column: number } | undefined;
  let totalFloor = 0;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (grid[r][c] !== "O") {
        totalFloor++;
        if (!firstFloor) firstFloor = { row: r, column: c };
      }
    }
  }
  assert.ok(firstFloor, "no floor cells found");
  const component = floodFill(grid, firstFloor!);
  assert.equal(component.size, totalFloor, "floor is not fully connected");
});

// ---------------------------------------------------------------------------
// generateBoardTemplate
// ---------------------------------------------------------------------------

test("generateBoardTemplate: correct dimensions", () => {
  const rng = createRng(400);
  const t = generateBoardTemplate(7, 6, 2, rng);
  assert.equal(t.width, 7);
  assert.equal(t.height, 6);
  assert.equal(t.grid.length, 6);
  assert.equal(t.grid[0].length, 7);
});

test("generateBoardTemplate: goal count matches boxCount", () => {
  const rng = createRng(500);
  const t = generateBoardTemplate(8, 8, 3, rng);
  assert.equal(t.goalPositions.length, 3);
});

test("generateBoardTemplate: robot on floor and reachable from goals", () => {
  const rng = createRng(600);
  const t = generateBoardTemplate(7, 7, 2, rng);
  assert.equal(t.grid[t.robotPosition.row][t.robotPosition.column], " ");
  const reachable = floodFill(t.grid, t.robotPosition);
  for (const g of t.goalPositions) {
    assert.ok(
      reachable.has(`${g.row},${g.column}`),
      `goal at (${g.row},${g.column}) not reachable from robot`,
    );
  }
});

// ---------------------------------------------------------------------------
// canRobotReach
// ---------------------------------------------------------------------------

test("canRobotReach: adjacent floor cell is reachable", () => {
  const grid = [
    ["O", "O", "O"],
    ["O", " ", " "],
    ["O", "O", "O"],
  ];
  const result = canRobotReach(
    grid,
    { row: 1, column: 1 },
    { row: 1, column: 2 },
    [],
  );
  assert.ok(result);
});

test("canRobotReach: blocked by box returns false", () => {
  const grid = [
    ["O", "O", "O", "O"],
    ["O", " ", " ", " "],
    ["O", "O", "O", "O"],
  ];
  const result = canRobotReach(
    grid,
    { row: 1, column: 1 },
    { row: 1, column: 3 },
    [{ row: 1, column: 2 }],
  );
  assert.equal(result, false);
});

test("canRobotReach: same position returns true", () => {
  const grid = [
    ["O", "O", "O"],
    ["O", " ", "O"],
    ["O", "O", "O"],
  ];
  const result = canRobotReach(
    grid,
    { row: 1, column: 1 },
    { row: 1, column: 1 },
    [],
  );
  assert.ok(result);
});

// ---------------------------------------------------------------------------
// enumerateReversePulls
// ---------------------------------------------------------------------------

test("enumerateReversePulls: box in open room has valid pulls", () => {
  const grid = [
    ["O", "O", "O", "O", "O", "O", "O"],
    ["O", " ", " ", " ", " ", " ", "O"],
    ["O", " ", " ", " ", " ", " ", "O"],
    ["O", " ", " ", " ", " ", " ", "O"],
    ["O", " ", " ", " ", " ", " ", "O"],
    ["O", " ", " ", " ", " ", " ", "O"],
    ["O", "O", "O", "O", "O", "O", "O"],
  ];
  const pulls = enumerateReversePulls(
    grid,
    [{ row: 3, column: 3 }],
    { row: 1, column: 1 },
  );
  assert.ok(pulls.length > 0, "should have at least one valid pull");
});

test("enumerateReversePulls: corner box has limited pulls", () => {
  const grid = [
    ["O", "O", "O", "O"],
    ["O", " ", " ", "O"],
    ["O", " ", "O", "O"],
    ["O", "O", "O", "O"],
  ];
  const pulls = enumerateReversePulls(
    grid,
    [{ row: 2, column: 1 }],
    { row: 1, column: 1 },
  );
  assert.ok(pulls.length <= 2, "corner box should have few pulls");
});

// ---------------------------------------------------------------------------
// scrambleByReversePull
// ---------------------------------------------------------------------------

test("scrambleByReversePull: produces correct box count", () => {
  const rng = createRng(700);
  const template = generateBoardTemplate(7, 7, 2, rng);
  const rng2 = createRng(701);
  const scrambled = scrambleByReversePull(template, 10, rng2);
  assert.equal(scrambled.boxPositions.length, template.goalPositions.length);
});

test("scrambleByReversePull: robot is on floor", () => {
  const rng = createRng(800);
  const template = generateBoardTemplate(8, 8, 3, rng);
  const rng2 = createRng(801);
  const scrambled = scrambleByReversePull(template, 15, rng2);
  const { row, column } = scrambled.robotPosition;
  assert.equal(template.grid[row][column], " ");
});

test("scrambleByReversePull: boxes are on floor cells", () => {
  const rng = createRng(900);
  const template = generateBoardTemplate(7, 7, 2, rng);
  const rng2 = createRng(901);
  const scrambled = scrambleByReversePull(template, 8, rng2);
  for (const bp of scrambled.boxPositions) {
    assert.equal(
      template.grid[bp.row][bp.column],
      " ",
      `box at (${bp.row},${bp.column}) is not on floor`,
    );
  }
});

// ---------------------------------------------------------------------------
// classifyFromMetrics
// ---------------------------------------------------------------------------

test("classifyFromMetrics: simple tutorial case", () => {
  const d = classifyFromMetrics(5, 3, 1);
  assert.equal(d, "tutorial");
});

test("classifyFromMetrics: intermediate boundary", () => {
  const d = classifyFromMetrics(50, 30, 4);
  assert.equal(d, "intermediate");
});

test("classifyFromMetrics: master when exceeding all thresholds", () => {
  const d = classifyFromMetrics(1000, 500, 15);
  assert.equal(d, "master");
});

test("classifyFromMetrics: beginner range", () => {
  const d = classifyFromMetrics(20, 10, 2);
  assert.equal(d, "beginner");
});

// ---------------------------------------------------------------------------
// buildPuzzleFromScramble
// ---------------------------------------------------------------------------

test("buildPuzzleFromScramble: produces valid puzzle", () => {
  const rng = createRng(1000);
  const template = generateBoardTemplate(7, 7, 2, rng);
  const rng2 = createRng(1001);
  const scrambled = scrambleByReversePull(template, 10, rng2);

  const goalKeys = new Set(
    template.goalPositions.map((g) => `${g.row},${g.column}`),
  );
  const allOffGoals = scrambled.boxPositions.every(
    (bp) => !goalKeys.has(`${bp.row},${bp.column}`),
  );

  if (!allOffGoals) {
    return;
  }

  const puzzle = buildPuzzleFromScramble(scrambled, "beginner");
  const validation = validatePuzzle(puzzle);
  assert.ok(validation.valid, `validation errors: ${validation.errors.map((e) => e.message).join("; ")}`);
});

test("buildPuzzleFromScramble: row count matches grid dimensions", () => {
  const rng = createRng(1100);
  const template = generateBoardTemplate(6, 6, 1, rng);
  const rng2 = createRng(1101);
  const scrambled = scrambleByReversePull(template, 5, rng2);
  const puzzle = buildPuzzleFromScramble(scrambled, "tutorial");
  assert.equal(puzzle.rows.length, 6);
  assert.equal(puzzle.rows[0].length, 6);
});

test("buildPuzzleFromScramble: contains robot, boxes, and goals", () => {
  const rng = createRng(1200);
  const template = generateBoardTemplate(7, 7, 2, rng);
  const rng2 = createRng(1201);
  const scrambled = scrambleByReversePull(template, 8, rng2);
  const puzzle = buildPuzzleFromScramble(scrambled, "beginner");
  const allChars = puzzle.rows.join("");
  assert.ok(allChars.includes("R"), "puzzle should contain robot");
  const boxCount = (allChars.match(/X/g) ?? []).length;
  assert.equal(boxCount, 2, "should have 2 boxes");
  const goalCount = (allChars.match(/S/g) ?? []).length;
  assert.equal(goalCount, 2, "should have 2 goals");
});

// ---------------------------------------------------------------------------
// VALID_LABELS
// ---------------------------------------------------------------------------

test("VALID_LABELS: exactly 22 entries, no O/R/S/X", () => {
  assert.equal(VALID_LABELS.length, 22);
  const forbidden = ["O", "R", "S", "X"];
  for (const label of VALID_LABELS) {
    assert.ok(
      !forbidden.includes(label),
      `label ${label} is in forbidden set`,
    );
  }
});

test("VALID_LABELS: all uppercase letters", () => {
  for (const label of VALID_LABELS) {
    assert.ok(
      label >= "A" && label <= "Z",
      `label ${label} is not uppercase`,
    );
  }
});
