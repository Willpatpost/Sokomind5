import assert from "node:assert/strict";
import test from "node:test";

import {
  isOptimal,
  setOptimalRecord,
  type OptimalCache,
  type OptimalRecord,
} from "../../src/shared/optimal-cache.ts";

const EMPTY_CACHE: OptimalCache = { version: 1, records: {} };

test("isOptimal returns false when no record exists", () => {
  assert.equal(isOptimal(EMPTY_CACHE, "puzzle-1", 10, 5), false);
});

test("isOptimal checks pushes for push-optimal records", () => {
  const record: OptimalRecord = { moves: 20, pushes: 8, objective: "pushes" };
  const cache = setOptimalRecord(EMPTY_CACHE, "p1", record);
  assert.equal(isOptimal(cache, "p1", 30, 8), true);
  assert.equal(isOptimal(cache, "p1", 30, 7), true);
  assert.equal(isOptimal(cache, "p1", 30, 9), false);
});

test("isOptimal checks moves for move-optimal records", () => {
  const record: OptimalRecord = { moves: 15, pushes: 10, objective: "moves" };
  const cache = setOptimalRecord(EMPTY_CACHE, "p1", record);
  assert.equal(isOptimal(cache, "p1", 15, 99), true);
  assert.equal(isOptimal(cache, "p1", 14, 99), true);
  assert.equal(isOptimal(cache, "p1", 16, 5), false);
});

test("isOptimal checks both for combined-optimal records", () => {
  const record: OptimalRecord = { moves: 15, pushes: 8, objective: "combined" };
  const cache = setOptimalRecord(EMPTY_CACHE, "p1", record);
  assert.equal(isOptimal(cache, "p1", 15, 8), true);
  assert.equal(isOptimal(cache, "p1", 14, 7), true);
  assert.equal(isOptimal(cache, "p1", 15, 9), false);
  assert.equal(isOptimal(cache, "p1", 16, 8), false);
});

test("setOptimalRecord creates and overwrites entries", () => {
  const r1: OptimalRecord = { moves: 20, pushes: 10, objective: "pushes" };
  const r2: OptimalRecord = { moves: 18, pushes: 9, objective: "pushes" };
  let cache = setOptimalRecord(EMPTY_CACHE, "p1", r1);
  assert.deepEqual(cache.records["p1"], r1);
  cache = setOptimalRecord(cache, "p1", r2);
  assert.deepEqual(cache.records["p1"], r2);
});

test("setOptimalRecord preserves other entries", () => {
  const r1: OptimalRecord = { moves: 10, pushes: 5, objective: "pushes" };
  const r2: OptimalRecord = { moves: 20, pushes: 8, objective: "moves" };
  let cache = setOptimalRecord(EMPTY_CACHE, "p1", r1);
  cache = setOptimalRecord(cache, "p2", r2);
  assert.deepEqual(cache.records["p1"], r1);
  assert.deepEqual(cache.records["p2"], r2);
});
