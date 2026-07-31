/**
 * The only module that talks directly to Web Storage.
 *
 * GitHub project pages share an origin, so every key is application-namespaced.
 * Reads and writes deliberately fail closed: private browsing, storage quotas,
 * and hardened browser settings must never prevent the game from running.
 */
export const STORAGE_KEYS = Object.freeze({
  progress: "sokomind.progress.v1",
  experience: "sokomind.experience.v1",
  session: "sokomind.session.v1",
  optimal: "sokomind.optimal.v2",
});

export const LEGACY_STORAGE_KEYS = Object.freeze({
  progress: "sokomind.progress.v1",
  experience: "sokomind.experience.v1",
  currentPuzzle: "sokomind.current-puzzle.v1",
  optimal: "sokomind.optimal.v1",
});

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredValue(
  key: string,
  legacyKeys: readonly string[] = [],
): string | null {
  const storage = browserStorage();
  if (!storage) return null;

  try {
    const current = storage.getItem(key);
    if (current !== null) return current;

    for (const legacyKey of legacyKeys) {
      const legacy = storage.getItem(legacyKey);
      if (legacy === null) continue;

      try {
        storage.setItem(key, legacy);
      } catch {
        // The legacy value is still usable for this page load.
      }
      return legacy;
    }
  } catch {
    return null;
  }

  return null;
}

export function writeStoredValue(key: string, value: string): boolean {
  const storage = browserStorage();
  if (!storage) return false;

  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStoredValue(key: string): boolean {
  const storage = browserStorage();
  if (!storage) return false;

  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
