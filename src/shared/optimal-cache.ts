import {
  LEGACY_STORAGE_KEYS,
  STORAGE_KEYS,
  readStoredValue,
  writeStoredValue,
} from "./storage.ts";

export interface OptimalRecord {
  readonly moves: number;
  readonly pushes: number;
}

export interface OptimalCache {
  readonly version: 2;
  readonly records: Readonly<Record<string, OptimalRecord>>;
}

const EMPTY_CACHE: OptimalCache = Object.freeze({
  version: 2,
  records: Object.freeze({}),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidCount(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0;
}

function normalizeRecord(
  value: unknown,
  legacy: boolean,
): OptimalRecord | undefined {
  if (!isRecord(value)) return undefined;
  const expectedKeys = legacy
    ? new Set(["moves", "pushes", "objective"])
    : new Set(["moves", "pushes"]);
  const keys = Object.keys(value);
  if (
    keys.length !== expectedKeys.size ||
    keys.some((key) => !expectedKeys.has(key))
  ) {
    return undefined;
  }
  if (legacy && value.objective !== "moves") return undefined;
  if (!isValidCount(value.moves) || !isValidCount(value.pushes)) {
    return undefined;
  }
  if (value.pushes > value.moves) return undefined;
  return Object.freeze({ moves: value.moves, pushes: value.pushes });
}

/**
 * Converts persisted data to the move-only schema. Legacy push and combined
 * records are discarded because they do not prove a minimum move count.
 */
export function normalizeOptimalCache(value: unknown): OptimalCache {
  if (!isRecord(value) || !isRecord(value.records)) return EMPTY_CACHE;
  if (value.version !== 1 && value.version !== 2) return EMPTY_CACHE;

  const legacy = value.version === 1;
  const records: Record<string, OptimalRecord> = {};
  for (const [puzzleId, candidate] of Object.entries(value.records)) {
    if (!puzzleId) continue;
    const record = normalizeRecord(candidate, legacy);
    if (record) records[puzzleId] = record;
  }
  return Object.freeze({
    version: 2,
    records: Object.freeze(records),
  });
}

export function loadOptimalCache(): OptimalCache {
  const raw = readStoredValue(STORAGE_KEYS.optimal, [
    LEGACY_STORAGE_KEYS.optimal,
  ]);
  if (!raw) return EMPTY_CACHE;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const cache = normalizeOptimalCache(parsed);
    if (isRecord(parsed) && parsed.version === 1) saveOptimalCache(cache);
    return cache;
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
    version: 2,
    records: { ...cache.records, [puzzleId]: record },
  };
}

export function isOptimal(
  cache: OptimalCache,
  puzzleId: string,
  playerMoves: number,
): boolean {
  const record = cache.records[puzzleId];
  if (!record) return false;
  return playerMoves <= record.moves;
}

export function getOptimalRecord(
  cache: OptimalCache,
  puzzleId: string,
): OptimalRecord | undefined {
  return cache.records[puzzleId];
}
