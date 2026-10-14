import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { certificationErrors, verifyWithCertification } from "./bundle-verify.mjs";
import { fixtureBundle, FIXTURE_CORE as CORE } from "./fixture-bundle.mjs";

function trunkRun(overrides = {}) {
  return {
    path: ".github/workflows/trunk.yml",
    event: "push",
    head_branch: "develop",
    conclusion: "success",
    head_sha: CORE,
    ...overrides,
  };
}

function withCertifiedBy(dir, value) {
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.certified_by = value;
  writeFileSync(manifestPath, JSON.stringify(manifest));
}

test("dispatch-certified bundles are refused without contacting the API", async () => {
  const dir = fixtureBundle();
  withCertifiedBy(dir, "dispatch");
  const result = await verifyWithCertification(dir);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ["certified_by dispatch is not a run id"]);
});

test("a numeric run id for the bundle commit passes the predicate", () => {
  assert.deepEqual(certificationErrors(trunkRun(), { core_sha: CORE }), []);
});

test("runs off the trunk path, branch, or verdict fail the predicate", () => {
  const manifest = { core_sha: CORE };
  assert.equal(certificationErrors(trunkRun({ path: ".github/workflows/ci.yml" }), manifest).length, 1);
  assert.equal(certificationErrors(trunkRun({ head_branch: "main" }), manifest).length, 1);
  assert.equal(certificationErrors(trunkRun({ conclusion: "failure" }), manifest).length, 1);
  assert.equal(certificationErrors(trunkRun({ head_sha: "0".repeat(40) }), manifest).length, 1);
});
