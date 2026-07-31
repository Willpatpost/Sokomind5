import assert from "node:assert/strict";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const buildDirectory = fileURLToPath(new URL("../dist/", import.meta.url));

async function readBuildFile(relativePath) {
  return readFile(path.join(buildDirectory, relativePath), "utf8");
}

test("builds a complete static GitHub Pages entry point", async () => {
  const html = await readBuildFile("index.html");

  assert.match(html, /<html lang="en">/i);
  assert.match(
    html,
    /<title>Sokomind \u2014 Thoughtful box puzzles<\/title>/i,
  );
  assert.match(html, /<div id="root"><\/div>/i);
  assert.doesNotMatch(
    html,
    /\b(?:src|href)=["']\/(?!\/)/i,
    "root-relative assets would break on a GitHub project page",
  );
  assert.doesNotMatch(html, /__PUBLIC_SITE_URL__/);
  assert.match(html, /rel="canonical"/);
  assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/);

  await Promise.all([
    access(path.join(buildDirectory, ".nojekyll")),
    access(path.join(buildDirectory, "favicon.svg")),
    access(path.join(buildDirectory, "og.png")),
    access(path.join(buildDirectory, "manifest.webmanifest")),
    access(path.join(buildDirectory, "sw.js")),
    access(path.join(buildDirectory, "icon-192.png")),
    access(path.join(buildDirectory, "icon-512.png")),
  ]);
});

test("asset manifest lists all hashed build assets", async () => {
  const manifest = JSON.parse(await readBuildFile("asset-manifest.json"));

  assert.ok(Array.isArray(manifest), "asset-manifest.json should be a JSON array");
  assert.ok(manifest.length > 0, "asset manifest should not be empty");

  for (const entry of manifest) {
    assert.ok(
      entry.startsWith("./assets/"),
      `manifest entry should be a relative assets path: ${entry}`,
    );
    const target = path.join(buildDirectory, entry);
    assert.equal(
      (await stat(target)).isFile(),
      true,
      `manifest references missing file: ${entry}`,
    );
  }
});

test("production output is installable and omits public source maps", async () => {
  const manifest = JSON.parse(await readBuildFile("manifest.webmanifest"));
  const worker = await readBuildFile("sw.js");
  const assets = await readdir(path.join(buildDirectory, "assets"));

  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(
    manifest.icons.map((icon) => icon.sizes),
    ["192x192", "512x512"],
  );
  assert.match(worker, /sokomind-shell/);
  assert.equal(
    assets.some((asset) => asset.endsWith(".map")),
    false,
    "production source maps should not be publicly deployed",
  );
  assert.equal(
    assets.some((asset) => /^solver\.worker-[\w-]+\.js$/.test(asset)),
    true,
    "the solver must be emitted as a standalone module worker",
  );
});

test("all local scripts and styles referenced by index.html are deployable", async () => {
  const html = await readBuildFile("index.html");
  const assetReferences = [
    ...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi),
  ]
    .map((match) => match[1])
    .filter((reference) => !/^(?:[a-z]+:|\/\/|#)/i.test(reference));

  assert.ok(assetReferences.length > 0, "the entry point should load local assets");

  for (const reference of assetReferences) {
    const pathname = reference.split(/[?#]/, 1)[0];
    const target = path.resolve(buildDirectory, pathname);
    const relativeTarget = path.relative(buildDirectory, target);

    assert.ok(
      relativeTarget !== ".." && !relativeTarget.startsWith(`..${path.sep}`),
      `asset escapes the build directory: ${reference}`,
    );
    assert.equal((await stat(target)).isFile(), true, `missing asset: ${reference}`);
  }
});

test("the client bundle contains the playable application", async () => {
  const assets = await readdir(path.join(buildDirectory, "assets"));
  const jsFiles = assets.filter((f) => f.endsWith(".js"));
  assert.ok(jsFiles.length > 0, "should have JS assets");

  const allCode = (
    await Promise.all(
      jsFiles.map((f) => readBuildFile(`assets/${f}`)),
    )
  ).join("\n");

  assert.match(allCode, /First Steps/);
  assert.match(allCode, /Current route/);
  assert.match(allCode, /Move up/);
  assert.match(allCode, /Sokomind/);
  assert.doesNotMatch(allCode, /dist\/server|Cloudflare|wrangler/i);
});
