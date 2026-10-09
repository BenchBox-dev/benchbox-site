import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { memberDigest, verifyBundle } from "./bundle-lib.mjs";
import { certificationErrors } from "./bundle-verify.mjs";
import { fixtureBundle, FIXTURE_CORE as CORE, FIXTURE_PARENT as PARENT } from "./fixture-bundle.mjs";

function write(file, body) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
}

test("schema 2 and schema 1 bundles both verify", () => {
  assert.deepEqual(verifyBundle(fixtureBundle()).errors, []);
  assert.deepEqual(verifyBundle(fixtureBundle({ schema: 1 })).errors, []);
});

test("a changed member fails its digest", () => {
  assert.ok(verifyBundle(fixtureBundle({ tamper: true })).errors.includes("digest mismatch: docs"));
});

test("an unsupported schema fails", () => {
  assert.ok(verifyBundle(fixtureBundle({ schema: 3 })).errors.some((error) => error.startsWith("schema 3")));
});

test("a failed or skipped required attestation fails", () => {
  assert.ok(verifyBundle(fixtureBundle({ attestationResult: "fail" })).errors.includes("attestation privacy failed"));
  assert.ok(
    verifyBundle(fixtureBundle({ attestationResult: "skip" })).errors.includes("required attestation privacy was skipped"),
  );
});

test("directory digests sort by path parts like the core producer", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "digest-order-"));
  write(path.join(dir, "a-b"), "1\n");
  write(path.join(dir, "a/b"), "2\n");
  const first = memberDigest(dir);
  assert.equal(memberDigest(dir), first);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test("certification requires a successful trunk push run on the bundle commit", () => {
  const good = { path: ".github/workflows/trunk.yml", event: "push", head_branch: "develop", conclusion: "success", head_sha: CORE };
  assert.deepEqual(certificationErrors(good, { core_sha: CORE }), []);
  assert.equal(certificationErrors({ ...good, event: "workflow_dispatch" }, { core_sha: CORE }).length, 1);
  assert.equal(certificationErrors({ ...good, head_sha: PARENT }, { core_sha: CORE }).length, 1);
  assert.deepEqual(certificationErrors(null, { core_sha: CORE }), ["certifying trunk run not found"]);
});
