import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_PROGRESS,
  mergeProgress,
  parseProgress,
  recordCompletion,
  tryParseProgress,
} from "../../src/shared/progress.ts";

test("invalid persisted progress fails closed", () => {
  assert.deepEqual(parseProgress("not json"), EMPTY_PROGRESS);
  assert.deepEqual(parseProgress('{"version":2,"completed":{}}'), EMPTY_PROGRESS);
});

test("distinguishes invalid imports and merges only better records", () => {
  assert.equal(tryParseProgress("not json"), null);

  const current = recordCompletion(EMPTY_PROGRESS, "room", 20, 5);
  const worse = recordCompletion(EMPTY_PROGRESS, "room", 40, 6);
  const better = recordCompletion(EMPTY_PROGRESS, "room", 18, 6);

  assert.deepEqual(mergeProgress(current, worse).completed.room, current.completed.room);
  const merged = mergeProgress(current, better);
  assert.equal(merged.completed.room?.moves, 18);
  assert.equal(
    merged.completed.room?.completedAt,
    better.completed.room?.completedAt,
  );
});

test("completion records retain the route with the fewest moves", () => {
  const first = recordCompletion(EMPTY_PROGRESS, "tiny", 30, 8);
  const slower = recordCompletion(first, "tiny", 35, 8);
  const fewerPushes = recordCompletion(slower, "tiny", 50, 7);
  const fewerMoves = recordCompletion(fewerPushes, "tiny", 20, 9);

  assert.equal(slower, first);
  assert.equal(fewerPushes, first);
  assert.equal(fewerMoves.completed.tiny.pushes, 9);
  assert.equal(fewerMoves.completed.tiny.moves, 20);
});
