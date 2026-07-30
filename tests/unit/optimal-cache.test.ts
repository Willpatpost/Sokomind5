import assert from "node:assert/strict";
import test from "node:test";

import {
  isOptimal,
  normalizeOptimalCache,
  setOptimalRecord,
  type OptimalCache,
  type OptimalRecord,
} from "../../src/shared/optimal-cache.ts";

const EMPTY_CACHE: OptimalCache = { version: 2, records: {} };

test("isOptimal compares only the proven move count", () => {
  assert.equal(isOptimal(EMPTY_CACHE, "missing", 10), false);

  const record: OptimalRecord = { moves: 15, pushes: 10 };
  const cache = setOptimalRecord(EMPTY_CACHE, "p1", record);
  assert.equal(isOptimal(cache, "p1", 15), true);
  assert.equal(isOptimal(cache, "p1", 14), true);
  assert.equal(isOptimal(cache, "p1", 16), false);
});

test("setOptimalRecord creates, overwrites, and preserves entries", () => {
  const first: OptimalRecord = { moves: 20, pushes: 10 };
  const replacement: OptimalRecord = { moves: 18, pushes: 9 };
  const other: OptimalRecord = { moves: 12, pushes: 4 };

  let cache = setOptimalRecord(EMPTY_CACHE, "p1", first);
  assert.deepEqual(cache.records["p1"], first);
  cache = setOptimalRecord(cache, "p1", replacement);
  cache = setOptimalRecord(cache, "p2", other);

  assert.deepEqual(cache.records["p1"], replacement);
  assert.deepEqual(cache.records["p2"], other);
  assert.equal(cache.version, 2);
});

test("legacy migration keeps only records that prove minimum moves", () => {
  const migrated = normalizeOptimalCache({
    version: 1,
    records: {
      moveProof: { moves: 15, pushes: 8, objective: "moves" },
      pushProof: { moves: 20, pushes: 5, objective: "pushes" },
      combinedProof: { moves: 18, pushes: 6, objective: "combined" },
      malformed: { moves: -1, pushes: 0, objective: "moves" },
    },
  });

  assert.deepEqual(migrated, {
    version: 2,
    records: {
      moveProof: { moves: 15, pushes: 8 },
    },
  });
});

test("current cache parsing drops malformed records safely", () => {
  const normalized = normalizeOptimalCache({
    version: 2,
    records: {
      valid: { moves: 11, pushes: 4 },
      impossible: { moves: 2, pushes: 3 },
      fractional: { moves: 4.5, pushes: 2 },
      obsolete: { moves: 8, pushes: 3, objective: "pushes" },
    },
  });

  assert.deepEqual(normalized, {
    version: 2,
    records: {
      valid: { moves: 11, pushes: 4 },
    },
  });
  assert.deepEqual(normalizeOptimalCache({ version: 99, records: {} }), EMPTY_CACHE);
});
