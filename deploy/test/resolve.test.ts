import { test } from "node:test";
import assert from "node:assert/strict";
import { chainErrors, deployedBundleErrors, freshness, redeployErrors } from "../lib/resolve.ts";
import { classifyFailure } from "../lib/relay.ts";
import { recheckErrors } from "../lib/recheck.ts";
import { verifyBundle } from "../../scripts/bundle-lib.mjs";
import { fixtureBundle } from "../../scripts/fixture-bundle.mjs";

const deployed = { core_sha: "a".repeat(40), corpus_sha: "c".repeat(40), site_sha: "5".repeat(40) };
const candidateSha = "b".repeat(40);
const newSiteSha = "6".repeat(40);

test("an ahead or identical bundle is fresh and no deployed receipt skips the check", () => {
  assert.deepEqual(freshness(null, candidateSha, newSiteSha, { status: 404 }), { action: "fresh" });
  assert.deepEqual(freshness(deployed, candidateSha, newSiteSha, { status: 200, body: { status: "ahead" } }), { action: "fresh" });
  assert.deepEqual(freshness(deployed, candidateSha, newSiteSha, { status: 200, body: { status: "identical" } }), { action: "fresh" });
});

test("a behind bundle with the deployed site commit is superseded and names both core commits", () => {
  const verdict = freshness(deployed, candidateSha, deployed.site_sha, { status: 200, body: { status: "behind" } });
  assert.equal(verdict.action, "superseded");
  if (verdict.action !== "superseded") return;
  assert.ok(verdict.notice.includes(candidateSha) && verdict.notice.includes(deployed.core_sha));
});

test("a behind bundle with a new site commit deploys the site commit with the deployed bundle", () => {
  const verdict = freshness(deployed, candidateSha, newSiteSha, { status: 200, body: { status: "behind" } });
  assert.equal(verdict.action, "use-deployed-bundle");
  if (verdict.action !== "use-deployed-bundle") return;
  for (const sha of [candidateSha, deployed.core_sha, newSiteSha]) assert.ok(verdict.notice.includes(sha));
});

test("a diverged bundle is refused with its own failure class", () => {
  const verdict = freshness(deployed, candidateSha, newSiteSha, { status: 200, body: { status: "diverged" } });
  assert.equal(verdict.action, "refuse");
  if (verdict.action !== "refuse") return;
  assert.match(verdict.errors[0], /diverged/);
  assert.equal(classifyFailure(verdict.errors.join("\n")), "diverged-bundle");
});

test("an unknown status or an unverifiable comparison fails closed", () => {
  const unknown = freshness(deployed, candidateSha, newSiteSha, { status: 200, body: {} });
  assert.equal(unknown.action, "refuse");
  assert.equal(classifyFailure(unknown.action === "refuse" ? unknown.errors.join("\n") : ""), "infrastructure");
  for (const status of [403, 404, 500, 502]) {
    const verdict = freshness(deployed, candidateSha, newSiteSha, { status });
    assert.equal(verdict.action, "refuse");
    if (verdict.action !== "refuse") return;
    assert.match(verdict.errors[0], new RegExp(`failed closed \\(HTTP ${status}\\)`));
    assert.equal(classifyFailure(verdict.errors[0]), "infrastructure");
  }
});

test("an unverifiable bundle is refused", () => {
  assert.ok(verifyBundle(fixtureBundle({ tamper: true })).errors.includes("digest mismatch: docs"));
  assert.ok(verifyBundle(fixtureBundle({ attestationResult: "fail" })).errors.length > 0);
});

test("candidate schema bundles verify offline and an unsupported schema is refused", () => {
  for (const schema of [4, 5]) assert.deepEqual(verifyBundle(fixtureBundle({ schema })).errors, []);
  assert.ok(verifyBundle(fixtureBundle({ schema: 2 })).errors.some((error: string) => error.startsWith("schema 2")));
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
  const otherDeployed = { core_sha: "b".repeat(40), corpus_sha: "c".repeat(40), site_sha: "7".repeat(40) };
  assert.equal(freshness(otherDeployed, "d".repeat(40), newSiteSha, { status: 200, body: { status: "behind" } }).action, "use-deployed-bundle");
  assert.equal(freshness(otherDeployed, "d".repeat(40), newSiteSha, { status: 200, body: { status: "ahead" } }).action, "fresh");
});

const receipt = { core_sha: deployed.core_sha, bundle_digest: `sha256:${"d".repeat(64)}` };

test("redeploy accepts the deployed bundle when the core commit and digest match the receipt", () => {
  assert.deepEqual(redeployErrors(deployed, "production"), []);
  assert.deepEqual(deployedBundleErrors(receipt, { core_sha: receipt.core_sha, digest: receipt.bundle_digest }), []);
});

test("redeploy fails closed on a digest or core commit that differs from the receipt", () => {
  const digest = `sha256:${"e".repeat(64)}`;
  const mismatch = deployedBundleErrors(receipt, { core_sha: receipt.core_sha, digest });
  assert.equal(mismatch.length, 1);
  assert.match(mismatch[0], /does not match the receipt/);
  assert.ok(mismatch[0].includes(digest) && mismatch[0].includes(receipt.bundle_digest));
  const wrongCommit = deployedBundleErrors(receipt, { core_sha: "f".repeat(40), digest: receipt.bundle_digest });
  assert.match(wrongCommit[0], /carries core_sha f{40}/);
});

test("redeploy with no deployed receipt fails with a named error instead of choosing the newest bundle", () => {
  const errors = redeployErrors(null, "production");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /redeploy needs a deployed receipt for target production/);
  assert.match(redeployErrors(null, "")[0], /target any/);
});
