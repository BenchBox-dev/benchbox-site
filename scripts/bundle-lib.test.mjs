import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { memberDigest, verifyBundle, REQUIRED_MEMBERS } from "./bundle-lib.mjs";
import { certificationErrors } from "./bundle-verify.mjs";

const CORE = "a".repeat(40);
const PARENT = "b".repeat(40);

function write(file, body) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
}

function fixtureBundle({ schema = 1, attestationResult = "pass", tamper = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "bundle-test-"));
  for (const member of REQUIRED_MEMBERS) {
    if (member === "attestations.json") continue;
    if (member.endsWith(".json") || member.endsWith(".duckdb")) write(path.join(dir, member), `${member}\n`);
    else write(path.join(dir, member, "item.txt"), `${member}\n`);
  }
  const snapshot = memberDigest(path.join(dir, "explorer/results.duckdb"));
  const attestations = [
    { name: "privacy", result: attestationResult, inputs: { bundle: "x" }, compared: { core_sha: CORE } },
    { name: "explorer_compat", result: "pass", inputs: { snapshot }, compared: { core_sha: CORE } },
    { name: "snapshot_invariants", result: "pass", inputs: { snapshot }, compared: { core_sha: CORE } },
    { name: "corpus_bijection", result: "pass", inputs: { snapshot }, compared: { accepted_ref: CORE } },
    { name: "validator_parity", result: "skip", reason: "corpus unchanged", compared: { base: PARENT, head: CORE } },
  ];
  write(path.join(dir, "attestations.json"), `${JSON.stringify(attestations)}\n`);
  const members = Object.fromEntries(REQUIRED_MEMBERS.map((member) => [member, memberDigest(path.join(dir, member))]));
  write(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      schema,
      core_sha: CORE,
      parent_core_sha: PARENT,
      parent_source: "bundle",
      corpus_sha: "c".repeat(40),
      package_version: "0.4.2",
      certified_by: "123",
      members,
    }),
  );
  if (tamper) write(path.join(dir, "docs/item.txt"), "changed\n");
  return dir;
}

test("a consistent bundle verifies", () => {
  const result = verifyBundle(fixtureBundle());
  assert.deepEqual(result.errors, []);
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
