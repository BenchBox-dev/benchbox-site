import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { compareTrees, normalizePath, normalizeText } from "./shadow-compare.mjs";

function tree(files) {
  const root = mkdtempSync(path.join(tmpdir(), "shadow-"));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), body);
  }
  return root;
}

test("content-hashed names, scoped classes and island ids are normalized", () => {
  assert.equal(normalizePath("_astro/page.Ab12Cd34.js"), "_astro/page.HASH.js");
  assert.equal(normalizePath("results/assets/index-Ab12_d34.js"), "results/assets/index-HASH.js");
  assert.equal(normalizeText('<html class="astro-g5ptsecz"><astro-island uid="Z4jODJ" x>'), '<html class="astro-HASH"><astro-island uid="UID" x>');
});

test("identical trees match and missing or changed files are reported", () => {
  const core = tree({ "index.html": "<p>a</p>", "docs/a.html": "<p>b</p>", "only-core.txt": "x" });
  const site = tree({ "index.html": "<p>a</p>", "docs/a.html": "<p>changed</p>", "only-site.txt": "y" });
  const report = compareTrees(core, site);
  assert.equal(report.matched, 1);
  assert.deepEqual(report.onlyCore, ["only-core.txt"]);
  assert.deepEqual(report.onlySite, ["only-site.txt"]);
  assert.equal(report.differ[0].file, "docs/a.html");
});

test("allowlisted files and rewrites explain differences", () => {
  const core = tree({ "_astro/x.Aaaaaaaa.js": "one", "a.html": '<a href="https://github.com/BenchBox-dev/BenchBox/blob/develop/x.py">' });
  const site = tree({ "_astro/x.Bbbbbbbb.js": "two", "a.html": `<a href="https://github.com/BenchBox-dev/BenchBox/blob/${"0".repeat(40)}/x.py">` });
  const report = compareTrees(
    core,
    site,
    [{ pattern: "^_astro/.+\\.HASH\\.js$" }],
    [{ pattern: "https://github\\.com/BenchBox-dev/BenchBox/(blob|tree)/(?:develop|[0-9a-f]{40})/", replacement: "REF/$1/" }],
  );
  assert.deepEqual(report.allowed, ["_astro/x.HASH.js"]);
  assert.equal(report.matched, 1);
  assert.deepEqual(report.differ, []);
});

test("Sphinx inventories compare by their decompressed content", () => {
  const header = Buffer.from("# Sphinx inventory version 2\n# Project: P\n# Version: 1\n# The remainder of this file is compressed using zlib.\n");
  const body = Buffer.from("a std:doc -1 a.html A\n");
  const core = tree({ "docs/objects.inv": Buffer.concat([header, deflateSync(body, { level: 9 })]) });
  const site = tree({ "docs/objects.inv": Buffer.concat([header, deflateSync(body, { level: 1 })]) });
  assert.equal(compareTrees(core, site).matched, 1);
});
