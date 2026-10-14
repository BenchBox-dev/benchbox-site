import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mapSitePath, loadAllowlist, checkFidelity, formatReport } from "./replay-fidelity.mjs";

test("seed renames map every seeded prefix and reject the rest", () => {
  assert.equal(mapSitePath("results-explorer/src/db.ts"), "explorer/src/db.ts");
  assert.equal(mapSitePath("docs/blog/a.md"), "blog/a.md");
  assert.equal(mapSitePath("_blog/drafts/a.md"), "drafts/drafts/a.md");
  assert.equal(mapSitePath("_project/design/site-inventory/a.json"), "inventory/a.json");
  assert.equal(mapSitePath("website/src/x.ts"), "website/src/x.ts");
  assert.equal(mapSitePath("landing/a.js"), "landing/a.js");
  assert.equal(mapSitePath("scripts/a.py"), null);
  assert.equal(mapSitePath("tests/a.py"), null);
});

test("fidelity check passes identical replays and flags the rest", () => {
  const core = mkdtempSync(path.join(tmpdir(), "fidelity-core-"));
  const site = mkdtempSync(path.join(tmpdir(), "fidelity-site-"));
  const git = (args, cwd = core) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" });
  git(["init", "-q", "-b", "main"]);
  mkdirSync(path.join(core, "results-explorer", "src"), { recursive: true });
  writeFileSync(path.join(core, "results-explorer", "src", "kept.ts"), "one\n");
  writeFileSync(path.join(core, "results-explorer", "src", "adapted.ts"), "one\n");
  writeFileSync(path.join(core, "results-explorer", "src", "dropped.ts"), "one\n");
  writeFileSync(path.join(core, "results-explorer", "src", "retired.ts"), "one\n");
  writeFileSync(path.join(core, "results-explorer", "src", "lingering.ts"), "one\n");
  git(["add", "."]);
  git(["commit", "-qm", "seed"]);
  const seed = git(["rev-parse", "HEAD"]).trim();
  writeFileSync(path.join(core, "results-explorer", "src", "kept.ts"), "two\n");
  writeFileSync(path.join(core, "results-explorer", "src", "adapted.ts"), "two\n");
  writeFileSync(path.join(core, "results-explorer", "src", "dropped.ts"), "two\n");
  git(["rm", "-q", "results-explorer/src/retired.ts", "results-explorer/src/lingering.ts"]);
  git(["add", "."]);
  git(["commit", "-qm", "change"]);
  const ref = git(["rev-parse", "HEAD"]).trim();
  mkdirSync(path.join(site, "explorer", "src"), { recursive: true });
  mkdirSync(path.join(site, "inventory"), { recursive: true });
  writeFileSync(path.join(site, "explorer", "src", "kept.ts"), "two\n");
  writeFileSync(path.join(site, "explorer", "src", "adapted.ts"), "site-flavoured two\n");
  writeFileSync(path.join(site, "explorer", "src", "lingering.ts"), "one\n");
  writeFileSync(
    path.join(site, "inventory", "replay-allowlist.json"),
    JSON.stringify([{ site: "explorer/src/adapted.ts", reason: "fixture adaptation" }]),
  );
  const { range, results } = checkFidelity({ coreRepo: core, siteRoot: site, sinceRef: seed, coreRef: ref });
  assert.equal(range.length, 1);
  const bySite = new Map(results.map((result) => [result.site, result.state]));
  assert.equal(bySite.get("explorer/src/kept.ts"), "identical");
  assert.equal(bySite.get("explorer/src/adapted.ts"), "allowlisted");
  assert.equal(bySite.get("explorer/src/dropped.ts"), "missing");
  assert.equal(bySite.get("explorer/src/retired.ts"), "removed");
  assert.equal(bySite.get("explorer/src/lingering.ts"), "core-removed");
  const { text, blocking } = formatReport({ range, results });
  assert.equal(blocking.length, 2);
  assert.match(text, /fidelity: 3\/5 clean, 2 blocking/);
});

test("allowlist loads keyed by site path", () => {
  const site = mkdtempSync(path.join(tmpdir(), "fidelity-allow-"));
  mkdirSync(path.join(site, "inventory"), { recursive: true });
  writeFileSync(path.join(site, "inventory", "replay-allowlist.json"), JSON.stringify([{ site: "a/b", reason: "why" }]));
  assert.equal(loadAllowlist(site).get("a/b"), "why");
});
