import { test } from "node:test";
import assert from "node:assert/strict";
import { chainErrors, freshnessErrors } from "../lib/resolve.ts";
import { recheckErrors } from "../lib/recheck.ts";
import { verifyBundle } from "../../scripts/bundle-lib.mjs";
import { fixtureBundle } from "../../scripts/fixture-bundle.mjs";

const deployed = { core_sha: "a".repeat(40), corpus_sha: "c".repeat(40) };

test("a fresh bundle is accepted and a stale or diverged one is refused", () => {
  assert.deepEqual(freshnessErrors(null, { status: 404 }), []);
  assert.deepEqual(freshnessErrors(deployed, { status: 200, body: { status: "ahead" } }), []);
  assert.deepEqual(freshnessErrors(deployed, { status: 200, body: { status: "identical" } }), []);
  assert.match(freshnessErrors(deployed, { status: 200, body: { status: "behind" } })[0], /behind relative to the deployed/);
  assert.match(freshnessErrors(deployed, { status: 200, body: { status: "diverged" } })[0], /diverged/);
});

test("an unverifiable freshness check fails closed", () => {
  for (const status of [403, 404, 500, 502]) {
    assert.match(freshnessErrors(deployed, { status })[0], new RegExp(`failed closed \\(HTTP ${status}\\)`));
  }
});

test("an unverifiable bundle is refused", () => {
  assert.ok(verifyBundle(fixtureBundle({ tamper: true })).errors.includes("digest mismatch: docs"));
  assert.ok(verifyBundle(fixtureBundle({ attestationResult: "fail" })).errors.length > 0);
});

test("a changed corpus needs validator parity from the deployed commit", () => {
  const candidate = (base: string | undefined, corpus = "9".repeat(40)) => ({
    core_sha: "b".repeat(40),
    corpus_sha: corpus,
    validator_parity: base === undefined ? undefined : { result: "pass", base },
  });
  assert.deepEqual(chainErrors(deployed, candidate(undefined, deployed.corpus_sha)), []);
  assert.deepEqual(chainErrors(deployed, candidate(deployed.core_sha)), []);
  assert.match(chainErrors(deployed, candidate("e".repeat(40)))[0], /parent_core_sha=a{40}/);
  assert.match(chainErrors(deployed, candidate(undefined))[0], /no validator_parity/);
  assert.deepEqual(chainErrors(null, candidate("e".repeat(40))), []);
});

test("overlapping runs: a run that resolved before another deployed refuses to deploy", () => {
  const before = "1".repeat(64);
  const afterOther = "2".repeat(64);
  assert.deepEqual(recheckErrors(before, before), []);
  assert.match(recheckErrors(before, afterOther)[0], /changed .* after this run resolved/);
  assert.match(recheckErrors(null, afterOther)[0], /changed from none/);
});

test("overlapping runs: a run that resolves after another deployed is checked against it", () => {
  const otherDeployed = { core_sha: "b".repeat(40), corpus_sha: "c".repeat(40) };
  assert.match(freshnessErrors(otherDeployed, { status: 200, body: { status: "behind" } })[0], /refusing an older or diverged bundle/);
  assert.deepEqual(freshnessErrors(otherDeployed, { status: 200, body: { status: "ahead" } }), []);
});
