import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { newestBundle, producingRunErrors } from "./bundle-fetch.mjs";

const RUN = {
  id: 38607974569,
  path: ".github/workflows/site-inputs.yml",
  event: "workflow_run",
  head_branch: "develop",
  conclusion: "success",
  head_sha: "d16a0761bfc79dbfdaa253bf121d194c2b8c7bd7",
  repository: { full_name: "BenchBox-dev/benchbox" },
};

const ARTIFACT = { name: "site-inputs-d16a0761bfc79dbfdaa253bf121d194c2b8c7bd7", expired: false };

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(run) {
  globalThis.fetch = async (url) => {
    const route = String(url).replace("https://api.github.com/", "");
    if (route.endsWith("/artifacts")) return { ok: true, json: async () => ({ artifacts: [ARTIFACT] }) };
    if (route.includes("/actions/runs/")) return { ok: true, json: async () => run };
    throw new Error(`unexpected route ${route}`);
  };
}

test("a develop workflow_run success passes the producing check", () => {
  assert.deepEqual(producingRunErrors(RUN), []);
});

test("a missing run fails closed", () => {
  assert.deepEqual(producingRunErrors(null), ["producing site-inputs run not found"]);
});

test("a foreign repository is refused", () => {
  const errors = producingRunErrors({ ...RUN, repository: { full_name: "SomeoneElse/other" } });
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes("SomeoneElse/other"));
});

test("a run from another workflow is refused", () => {
  const errors = producingRunErrors({ ...RUN, path: ".github/workflows/trunk.yml" });
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes("trunk.yml"));
});

test("a nested workflow with the same name is refused", () => {
  const errors = producingRunErrors({ ...RUN, path: "nested/.github/workflows/site-inputs.yml" });
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes("nested/.github/workflows/site-inputs.yml"));
});

test("a non-develop branch is refused", () => {
  const errors = producingRunErrors({ ...RUN, head_branch: "feature" });
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes("feature"));
});

test("a push event is refused", () => {
  const errors = producingRunErrors({ ...RUN, event: "push" });
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes("push"));
});

test("a workflow_dispatch event passes", () => {
  assert.deepEqual(producingRunErrors({ ...RUN, event: "workflow_dispatch" }), []);
});

test("a non-success conclusion is refused", () => {
  const errors = producingRunErrors({ ...RUN, conclusion: "failure" });
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes("failure"));
});

test("a run id fetch refuses a failing producing run", async () => {
  stubFetch({ ...RUN, conclusion: "failure" });
  await assert.rejects(newestBundle({ SITE_INPUTS_RUN_ID: "38607974569" }), /concluded failure/);
});

test("a run id fetch accepts the recorded develop run", async () => {
  stubFetch(RUN);
  const found = await newestBundle({ SITE_INPUTS_RUN_ID: "38607974569" });
  assert.equal(found.runId, "38607974569");
});
