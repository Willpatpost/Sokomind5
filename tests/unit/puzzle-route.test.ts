import assert from "node:assert/strict";
import test from "node:test";
import { parseHash } from "../../src/router/parse-hash.ts";
import {
  createShareUrl,
  playHash,
  editorHash,
  puzzlesHash,
  homeHash,
} from "../../src/router/navigation.ts";

test("parses play route with action log", () => {
  const result = parseHash("#/play/grand-hall?play=UDLR");
  assert.equal(result.kind, "route");
  if (result.kind === "route") {
    assert.equal(result.route.page, "play");
    if (result.route.page === "play") {
      assert.equal(result.route.puzzleId, "grand-hall");
      assert.equal(result.route.actionLog, "UDLR");
    }
  }
});

test("parses play route without action log", () => {
  const result = parseHash("#/play/huge");
  assert.equal(result.kind, "route");
  if (result.kind === "route" && result.route.page === "play") {
    assert.equal(result.route.puzzleId, "huge");
    assert.equal(result.route.actionLog, undefined);
  }
});

test("parses home route", () => {
  const r1 = parseHash("#/");
  const r2 = parseHash("");
  assert.equal(r1.kind, "route");
  assert.equal(r2.kind, "route");
  if (r1.kind === "route") assert.equal(r1.route.page, "home");
  if (r2.kind === "route") assert.equal(r2.route.page, "home");
});

test("parses puzzle selector routes", () => {
  const r1 = parseHash("#/puzzles");
  assert.equal(r1.kind, "route");
  if (r1.kind === "route") assert.equal(r1.route.page, "puzzles");

  const r2 = parseHash("#/puzzles/intermediate");
  assert.equal(r2.kind, "route");
  if (r2.kind === "route") assert.equal(r2.route.page, "puzzles-difficulty");

  const r3 = parseHash("#/puzzles/intermediate/Microban");
  assert.equal(r3.kind, "route");
  if (r3.kind === "route") assert.equal(r3.route.page, "puzzles-collection");
});

test("parses editor route with custom data", () => {
  const result = parseHash("#/editor?custom=abc123");
  assert.equal(result.kind, "route");
  if (result.kind === "route" && result.route.page === "editor") {
    assert.equal(result.route.customData, "abc123");
  }
});

test("redirects legacy puzzle hash", () => {
  const result = parseHash("#puzzle=grand-hall");
  assert.equal(result.kind, "redirect");
  if (result.kind === "redirect") {
    assert.equal(result.hash, "#/play/grand-hall");
  }
});

test("redirects legacy puzzle hash with play", () => {
  const result = parseHash("#puzzle=huge&play=RR");
  assert.equal(result.kind, "redirect");
  if (result.kind === "redirect") {
    assert.equal(result.hash, "#/play/huge?play=RR");
  }
});

test("redirects legacy custom hash", () => {
  const result = parseHash("#custom=encodeddata");
  assert.equal(result.kind, "redirect");
  if (result.kind === "redirect") {
    assert.equal(result.hash, "#/editor?custom=encodeddata");
  }
});

test("navigation helpers produce correct hashes", () => {
  assert.equal(homeHash(), "#/");
  assert.equal(puzzlesHash(), "#/puzzles");
  assert.equal(playHash("huge"), "#/play/huge");
  assert.equal(playHash("huge", "UDLR"), "#/play/huge?play=UDLR");
  assert.equal(editorHash(), "#/editor");
  assert.equal(editorHash("abc"), "#/editor?custom=abc");
});

test("preserves a static-site path when creating share URLs", () => {
  const url = createShareUrl(
    { origin: "https://example.test", pathname: "/Sokomind/index.html" },
    "huge",
    "RR",
  );
  assert.equal(
    url,
    "https://example.test/Sokomind/index.html#/play/huge?play=RR",
  );
});
