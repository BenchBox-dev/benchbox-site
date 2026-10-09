import { test } from "node:test";
import assert from "node:assert/strict";
import { isLastKnownGood, latencySeconds, parseStatusDescription, receiptBytes, receiptErrors, receiptSha, statusDescription } from "../lib/receipt.ts";
import { receipt } from "./helpers.ts";

test("receipt bytes are canonical and their sha256 is stable", () => {
  const value = receipt();
  const reordered = Object.fromEntries(Object.entries(value).reverse()) as typeof value;
  assert.equal(receiptBytes(reordered), receiptBytes(value));
  assert.equal(receiptSha(reordered), receiptSha(value));
  assert.ok(receiptBytes(value).endsWith("}\n"));
});

test("the deployment status description round-trips and fits GitHub's limit", () => {
  const value = receipt({ run_id: "37884131752" });
  const description = statusDescription(value);
  assert.ok(description.length <= 140);
  assert.deepEqual(parseStatusDescription(description), { sha: receiptSha(value), runId: "37884131752" });
  assert.equal(parseStatusDescription("deployed"), null);
});

test("invalid receipts are rejected", () => {
  assert.deepEqual(receiptErrors(receipt()), []);
  assert.ok(receiptErrors({ ...receipt(), core_sha: "abc" }).some((error) => error.includes("core_sha")));
  assert.ok(receiptErrors({ ...receipt(), schema: "other" as never }).some((error) => error.includes("schema")));
  const missing = { ...receipt() } as Record<string, unknown>;
  delete missing.snapshot_read_model_version;
  assert.ok(receiptErrors(missing).includes("receipt is missing snapshot_read_model_version"));
});

test("only receipts with green gates and probes are last known good", () => {
  assert.equal(isLastKnownGood(receipt()), true);
  assert.equal(isLastKnownGood(receipt({ probes: { ok: false, matched: 0, mismatched: ["/"], errors: [], attempts: 6 } })), false);
  assert.equal(isLastKnownGood(receipt({ gates: { ok: false, results: {} } })), false);
  assert.equal(isLastKnownGood(receipt({ target: "none" })), false);
  assert.equal(isLastKnownGood(null), false);
});

test("core-merge-to-live latency is measured in seconds", () => {
  assert.equal(latencySeconds("2026-10-08T23:50:00Z", "2026-10-09T00:05:00Z"), 900);
  assert.equal(latencySeconds(null, "2026-10-09T00:05:00Z"), null);
});
