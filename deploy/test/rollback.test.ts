import { test } from "node:test";
import assert from "node:assert/strict";
import { automaticRollback, rollbackTargetErrors } from "../lib/rollback.ts";
import { receipt } from "./helpers.ts";

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
