import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPECTED_READ_MODEL_VERSION } from "../explorer/scripts/explorer-build-contract.mjs";
import { driftErrors } from "./check-contract-drift.mjs";

test("equal read-model versions pass", () => {
  assert.deepEqual(driftErrors(EXPECTED_READ_MODEL_VERSION, { read_model_version: EXPECTED_READ_MODEL_VERSION }), []);
});

test("a newer bundle contract fails naming both versions", () => {
  const errors = driftErrors(EXPECTED_READ_MODEL_VERSION, { read_model_version: EXPECTED_READ_MODEL_VERSION + 1 });
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes(String(EXPECTED_READ_MODEL_VERSION)));
  assert.ok(errors[0].includes(String(EXPECTED_READ_MODEL_VERSION + 1)));
});

test("an older bundle contract fails naming both versions", () => {
  const errors = driftErrors(EXPECTED_READ_MODEL_VERSION, { read_model_version: EXPECTED_READ_MODEL_VERSION - 1 });
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes(String(EXPECTED_READ_MODEL_VERSION)));
  assert.ok(errors[0].includes(String(EXPECTED_READ_MODEL_VERSION - 1)));
});

test("a missing contract fails closed", () => {
  const errors = driftErrors(EXPECTED_READ_MODEL_VERSION, undefined);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes(String(EXPECTED_READ_MODEL_VERSION)));
});
