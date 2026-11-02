import { test } from "node:test";
import assert from "node:assert/strict";
import { runGates } from "../gates/index.ts";
import { automaticRollback, rollbackTargetErrors } from "../lib/rollback.ts";
import { receipt, site } from "./helpers.ts";

test("passing probes never roll back", () => {
  assert.equal(automaticRollback({ mode: "deploy", probesOk: true, lastKnownGood: receipt(), currentRunId: "200" }).dispatch, false);
});

test("a failed deploy rolls back to the last known good receipt", () => {
  const decision = automaticRollback({ mode: "deploy", probesOk: false, lastKnownGood: receipt({ run_id: "150" }), currentRunId: "200" });
  assert.deepEqual(decision, { dispatch: true, targetRunId: "150", reason: "rolling back to run 150" });
});

test("with no green receipt yet, a failed deploy opens an issue instead of rolling back", () => {
  assert.equal(automaticRollback({ mode: "deploy", probesOk: false, lastKnownGood: null, currentRunId: "200" }).dispatch, false);
  const red = receipt({ probes: { ok: false, matched: 0, mismatched: ["/"], errors: [], attempts: 6 } });
  assert.match(automaticRollback({ mode: "deploy", probesOk: false, lastKnownGood: red, currentRunId: "200" }).reason, /no receipt with green gates and probes/);
});

test("a failing rollback never triggers another rollback", () => {
  const decision = automaticRollback({ mode: "rollback", probesOk: false, lastKnownGood: receipt({ run_id: "150" }), currentRunId: "201" });
  assert.equal(decision.dispatch, false);
  assert.match(decision.reason, /never triggers another rollback/);
});

test("a rollback target must be a recorded, last known good receipt of that run", () => {
  assert.deepEqual(rollbackTargetErrors(receipt({ run_id: "150" }), "150"), []);
  assert.match(rollbackTargetErrors(null, "150")[0], /no receipt of run 150/);
  assert.match(rollbackTargetErrors(receipt({ run_id: "151" }), "150")[0], /does not match/);
  assert.match(rollbackTargetErrors(receipt({ run_id: "150", gates: { ok: false, results: {} } }), "150")[0], /not last known good/);
  assert.deepEqual(rollbackTargetErrors(receipt({ run_id: "150", mode: "rollback", rollback_of: "120" }), "150"), []);
});

const EXPLORER = {
  "results/index.html": "<!doctype html><html><head></head><body></body></html>",
  "results/assets/index.js": "console.log(1)",
  "results/assets/index.css": "body{}",
  "results/data/results.duckdb": "duckdb-bytes",
};

const PRE_ALLOWANCE_REMOVAL = {
  ...EXPLORER,
  "index.html": '<html><body><a href="/docs/guide.html#gone">guide</a></body></html>',
  "404.html": "<html></html>",
  "docs/guide.html": '<html><body><h2 id="intro">x</h2></body></html>',
};

function gateInputs(mode: "deploy" | "rollback", files: Record<string, string> = PRE_ALLOWANCE_REMOVAL) {
  return {
    siteDir: site(files),
    mode,
    target: "",
    corpusSha: "c".repeat(40),
    uiVersion: 14,
    snapshotVersion: 14,
    allowance: [],
    originAllowlist: [],
    extraHosts: [],
    candidateCanonical: "0".repeat(64),
    deployed: { corpus_sha: "c".repeat(40), snapshot_sha256: "9".repeat(64), snapshot_canonical_sha256: "8".repeat(64), ui: 14, snapshot: 14 },
  };
}

test("a rollback to an artifact with links the current allowance no longer covers passes the gates", () => {
  assert.equal(runGates(gateInputs("deploy")).results.links.status, "fail");
  const restored = runGates(gateInputs("rollback"));
  assert.equal(restored.results.links.status, "skipped");
  assert.equal(restored.results.snapshot_digest.status, "skipped");
  assert.equal(restored.ok, true);
});

test("a rollback still refuses an artifact carrying a secret", () => {
  const report = runGates(gateInputs("rollback", { ...PRE_ALLOWANCE_REMOVAL, "leak.txt": "ghp_123456789012345678901234567890123456" }));
  assert.equal(report.results.privacy.status, "fail");
  assert.equal(report.ok, false);
});
