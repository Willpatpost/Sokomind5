import type { Route, PuzzleDifficulty } from "./routes";

const VALID_DIFFICULTIES: ReadonlySet<string> = new Set([
  "tutorial",
  "beginner",
  "intermediate",
  "advanced",
  "expert",
  "master",
]);

export type ParseResult =
  | { readonly kind: "route"; readonly route: Route }
  | { readonly kind: "redirect"; readonly hash: string };

export function parseHash(hash: string): ParseResult {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;

  const legacy = detectLegacy(raw);
  if (legacy) return { kind: "redirect", hash: legacy };

  if (!raw || raw === "/") {
    return { kind: "route", route: { page: "home" } };
  }

  const path = raw.startsWith("/") ? raw : `/${raw}`;
  const qIndex = path.indexOf("?");
  const pathname = qIndex >= 0 ? path.slice(0, qIndex) : path;
  const queryString = qIndex >= 0 ? path.slice(qIndex + 1) : "";
  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] === "play" && segments.length >= 2) {
    const puzzleId = decodeURIComponent(segments[1]);
    const params = new URLSearchParams(queryString);
    const actionLog = params.get("play") ?? undefined;
    return { kind: "route", route: { page: "play", puzzleId, actionLog } };
  }

  if (segments[0] === "editor") {
    const params = new URLSearchParams(queryString);
    const customData = params.get("custom") ?? undefined;
    return { kind: "route", route: { page: "editor", customData } };
  }

  if (segments[0] === "puzzles") {
    if (segments.length === 1) {
      return { kind: "route", route: { page: "puzzles" } };
    }
    if (segments.length >= 2 && VALID_DIFFICULTIES.has(segments[1])) {
      const difficulty = segments[1] as PuzzleDifficulty;
      if (segments.length === 2) {
        return { kind: "route", route: { page: "puzzles-difficulty", difficulty } };
      }
      const collection = decodeURIComponent(segments[2]);
      return { kind: "route", route: { page: "puzzles-collection", difficulty, collection } };
    }
  }

  return { kind: "route", route: { page: "home" } };
}

function detectLegacy(raw: string): string | null {
  if (raw.startsWith("puzzle=")) {
    const params = new URLSearchParams(raw);
    const puzzleId = params.get("puzzle");
    if (!puzzleId) return null;
    const play = params.get("play");
    const base = `#/play/${encodeURIComponent(puzzleId)}`;
    return play ? `${base}?play=${encodeURIComponent(play)}` : base;
  }

  if (raw.startsWith("custom=")) {
    const data = raw.slice("custom=".length);
    return `#/editor?custom=${encodeURIComponent(data)}`;
  }

  return null;
}
