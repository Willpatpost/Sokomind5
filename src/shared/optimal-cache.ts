import type { SolverObjectiveKind } from "@/src/solver/contracts";
import { STORAGE_KEYS, readStoredValue, writeStoredValue } from "./storage.ts";

export interface OptimalRecord {
  readonly moves: number;
  readonly pushes: number;
  readonly objective: SolverObjectiveKind;
}

export interface OptimalCache {
  readonly version: 1;
  readonly records: Readonly<Record<string, OptimalRecord>>;
}

const EMPTY_CACHE: OptimalCache = Object.freeze({
  version: 1,
  records: Object.freeze({}),
});

export function loadOptimalCache(): OptimalCache {
  const raw = readStoredValue(STORAGE_KEYS.optimal);
  if (!raw) return EMPTY_CACHE;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      (parsed as { version: unknown }).version === 1 &&
      "records" in parsed &&
      typeof (parsed as { records: unknown }).records === "object"
    ) {
      return parsed as OptimalCache;
    }
  } catch {
    // Corrupt data; start fresh.
  }
  return EMPTY_CACHE;
}

export function saveOptimalCache(cache: OptimalCache): void {
  writeStoredValue(STORAGE_KEYS.optimal, JSON.stringify(cache));
}

export function setOptimalRecord(
  cache: OptimalCache,
  puzzleId: string,
  record: OptimalRecord,
): OptimalCache {
  return {
    version: 1,
    records: { ...cache.records, [puzzleId]: record },
  };
}

export function isOptimal(
  cache: OptimalCache,
  puzzleId: string,
  playerMoves: number,
  playerPushes: number,
): boolean {
  const record = cache.records[puzzleId];
  if (!record) return false;

  switch (record.objective) {
    case "pushes":
      return playerPushes <= record.pushes;
    case "moves":
      return playerMoves <= record.moves;
    case "combined":
      return (
        playerMoves <= record.moves && playerPushes <= record.pushes
      );
  }
}

export function getOptimalRecord(
  cache: OptimalCache,
  puzzleId: string,
): OptimalRecord | undefined {
  return cache.records[puzzleId];
}
