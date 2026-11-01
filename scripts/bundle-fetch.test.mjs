import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  newestBundle,
  newestByCommitOrder,
  producingRunErrors,
  producingRun,
  MAX_PRODUCING_RUN_WAIT_MS,
} from "./bundle-fetch.mjs";
import { readFileSync } from "node:fs";
import { downloadWithRetry as downloadArtifactWithRetry, isRetryableDownloadError, DOWNLOAD_RETRY_INTERVALS_MS } from "./github-download.mjs";

const RUN = {
  id: 38607974569,
  path: ".github/workflows/site-inputs.yml",
  event: "workflow_run",
  head_branch: "develop",
  status: "completed",
  conclusion: "success",
  head_sha: "d16a0761bfc79dbfdaa253bf121d194c2b8c7bd7",
  repository: { full_name: "BenchBox-dev/benchbox" },
};

const ARTIFACT = { name: "site-inputs-d16a0761bfc79dbfdaa253bf121d194c2b8c7bd7", expired: false };

const BUNDLE_JOB = { name: "build bundle", status: "completed", conclusion: "success" };

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(run, job = BUNDLE_JOB) {
  globalThis.fetch = async (url) => {
    const route = String(url).replace("https://api.github.com/", "");
    if (route.includes("/workflows/site-inputs.yml/runs")) return { ok: true, json: async () => ({ workflow_runs: [] }) };
    if (route.includes("/jobs?")) return { ok: true, json: async () => ({ jobs: [job] }) };
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

test("a run id fetch refuses a failed bundle job", async () => {
  stubFetch(RUN, { ...BUNDLE_JOB, conclusion: "failure" });
  await assert.rejects(newestBundle({ SITE_INPUTS_RUN_ID: "38607974569" }), /concluded failure/);
});

test("a run id fetch accepts the recorded develop run", async () => {
  stubFetch(RUN);
  const found = await newestBundle({ SITE_INPUTS_RUN_ID: "38607974569" });
  assert.equal(found.runId, "38607974569");
});

const jobsFetch = (run, jobsFor) => {
  const calls = [];
  const fetchJson = async (route) => {
    calls.push(route);
    if (route.includes("/jobs?")) return { jobs: jobsFor(calls.filter((item) => item.includes("/jobs?")).length) };
    return run;
  };
  return { calls, fetchJson };
};

function clockedOptions(extra = {}) {
  const state = { clock: 0, slept: [] };
  state.options = {
    now: () => state.clock,
    sleep: async (ms) => {
      state.slept.push(ms);
      state.clock += ms;
    },
    log: () => {},
    ...extra,
  };
  return state;
}

test("bundle job in_progress then success proceeds", async () => {
  const stub = jobsFetch({ ...RUN, status: "in_progress", conclusion: null }, (poll) => [
    poll === 1 ? { ...BUNDLE_JOB, status: "in_progress", conclusion: null } : BUNDLE_JOB,
  ]);
  const state = clockedOptions({ fetchJson: stub.fetchJson });
  await producingRun("38607974569", {}, state.options);
  assert.deepEqual(state.slept, [5000]);
});

test("a succeeded bundle job proceeds while a later job is queued", async () => {
  const stub = jobsFetch({ ...RUN, status: "in_progress", conclusion: null }, () => [
    BUNDLE_JOB,
    { name: "close the bundle-failure issue", status: "queued", conclusion: null },
  ]);
  const state = clockedOptions({ fetchJson: stub.fetchJson });
  await producingRun("38607974569", {}, state.options);
  assert.deepEqual(state.slept, []);
  assert.equal(stub.calls.length, 2);
});

test("a queued bundle job waits and then times out at the cap", async () => {
  const stub = jobsFetch({ ...RUN, status: "queued", conclusion: null }, () => [{ ...BUNDLE_JOB, status: "queued", conclusion: null }]);
  const state = clockedOptions({ fetchJson: stub.fetchJson, maxWaitMs: 15000 });
  await assert.rejects(producingRun("38607974569", {}, state.options), /bundle job did not complete within the 15s wait cap/);
  assert.equal(state.clock, 15000);
  assert.deepEqual(state.slept, [5000, 10000]);
});

test("a failed bundle job fails immediately without waiting", async () => {
  const stub = jobsFetch({ ...RUN, status: "in_progress", conclusion: null }, () => [
    { ...BUNDLE_JOB, conclusion: "failure" },
    { name: "report failed bundle", status: "queued", conclusion: null },
  ]);
  const state = clockedOptions({ fetchJson: stub.fetchJson });
  await assert.rejects(producingRun("38607974569", {}, state.options), /"build bundle" concluded failure/);
  assert.deepEqual(state.slept, []);
});

test("a completed run without a finished bundle job fails closed", async () => {
  const stub = jobsFetch(RUN, () => [{ name: "close the bundle-failure issue", status: "completed", conclusion: "success" }]);
  const state = clockedOptions({ fetchJson: stub.fetchJson });
  await assert.rejects(producingRun("38607974569", {}, state.options), /completed without a finished "build bundle" job/);
  assert.deepEqual(state.slept, []);
});

test("a run fetch fails closed when the bundle artifact is missing", async () => {
  globalThis.fetch = async (url) => {
    const route = String(url).replace("https://api.github.com/", "");
    if (route.includes("/jobs?")) return { ok: true, json: async () => ({ jobs: [BUNDLE_JOB] }) };
    if (route.endsWith("/artifacts")) return { ok: true, json: async () => ({ artifacts: [] }) };
    if (route.includes("/actions/runs/")) return { ok: true, json: async () => ({ ...RUN, status: "in_progress", conclusion: null }) };
    throw new Error(`unexpected route ${route}`);
  };
  await assert.rejects(newestBundle({ SITE_INPUTS_RUN_ID: "38607974569" }), /has no unexpired site-inputs artifact/);
});

test("a run id fetch proceeds with the artifact while a trailing job is queued", async () => {
  globalThis.fetch = async (url) => {
    const route = String(url).replace("https://api.github.com/", "");
    if (route.includes("/workflows/site-inputs.yml/runs")) return { ok: true, json: async () => ({ workflow_runs: [] }) };
    if (route.includes("/jobs?")) {
      return { ok: true, json: async () => ({ jobs: [BUNDLE_JOB, { name: "close the bundle-failure issue", status: "queued", conclusion: null }] }) };
    }
    if (route.endsWith("/artifacts")) return { ok: true, json: async () => ({ artifacts: [ARTIFACT] }) };
    if (route.includes("/actions/runs/")) return { ok: true, json: async () => ({ ...RUN, status: "in_progress", conclusion: null }) };
    throw new Error(`unexpected route ${route}`);
  };
  const found = await newestBundle({ SITE_INPUTS_RUN_ID: "38607974569" });
  assert.equal(found.runId, "38607974569");
});

test("download retry on 503 then success proceeds", () => {
  let calls = 0;
  const slept = [];
  const result = downloadArtifactWithRetry(
    () => {
      calls += 1;
      if (calls === 1) throw new Error("HTTP 503: 503 Egress is over the account limit");
      return "downloaded";
    },
    {
      sleep: (ms) => {
        slept.push(ms);
      },
      log: () => {},
    },
  );
  assert.equal(result, "downloaded");
  assert.equal(calls, 2);
  assert.deepEqual(slept, [5000]);
});

test("download retry fails after three 503 attempts", () => {
  let calls = 0;
  const slept = [];
  assert.throws(
    () => {
      downloadArtifactWithRetry(
        () => {
          calls += 1;
          throw new Error("HTTP 503: 503 Egress is over the account limit");
        },
        {
          sleep: (ms) => {
            slept.push(ms);
          },
          log: () => {},
        },
      );
    },
    /503 Egress is over the account limit/,
  );
  assert.equal(calls, 3);
  assert.deepEqual(slept, [5000, 15000]);
});

test("404 and 403 errors are not retried", () => {
  let calls = 0;
  assert.throws(
    () => {
      downloadArtifactWithRetry(() => {
        calls += 1;
        throw new Error("HTTP 404: Not Found");
      });
    },
    /HTTP 404/,
  );
  assert.equal(calls, 1);

  assert.throws(
    () => {
      downloadArtifactWithRetry(() => {
        calls += 1;
        throw new Error("HTTP 403: Resource not accessible by integration");
      });
    },
    /HTTP 403/,
  );
  assert.equal(calls, 2);
});

test("digest mismatch is not retried", () => {
  let calls = 0;
  assert.throws(
    () => {
      downloadArtifactWithRetry(() => {
        calls += 1;
        throw new Error("bundle digest sha256:abc does not match sha256:def");
      });
    },
    /bundle digest/,
  );
  assert.equal(calls, 1);
});

test("isRetryableDownloadError classifies correctly", () => {
  assert.equal(isRetryableDownloadError(new Error("HTTP 503: Service Unavailable")), true);
  assert.equal(isRetryableDownloadError(new Error("HTTP 500: Internal Server Error")), true);
  assert.equal(isRetryableDownloadError(new Error("fetch failed: ECONNRESET")), true);
  assert.equal(isRetryableDownloadError(new Error("HTTP 404: Not Found")), false);
  assert.equal(isRetryableDownloadError(new Error("HTTP 403: Forbidden")), false);
  assert.equal(isRetryableDownloadError(new Error("digest mismatch: sha256:123 vs sha256:456")), false);
  assert.equal(isRetryableDownloadError(new Error("gate failed: snapshot_digest")), false);
});

test("wait budget is below the actual deploy workflow timeout", () => {
  const workflow = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  const timeoutMinutes = Number(workflow.match(/timeout-minutes:\s*(\d+)/)[1]);
  assert.equal(MAX_PRODUCING_RUN_WAIT_MS, 600000);
  assert.deepEqual(DOWNLOAD_RETRY_INTERVALS_MS, [5000, 15000]);
  assert.ok(MAX_PRODUCING_RUN_WAIT_MS + DOWNLOAD_RETRY_INTERVALS_MS.reduce((a, b) => a + b, 0) < timeoutMinutes * 60000);
});

const sha = (letter) => letter.repeat(40);

function stubRecentRuns(shas) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const route = String(url).replace("https://api.github.com/", "");
    calls.push(route);
    if (route.includes("/workflows/site-inputs.yml/runs")) {
      return { ok: true, json: async () => ({ workflow_runs: shas.map((_, index) => ({ id: 1000 + index })) }) };
    }
    const artifacts = route.match(/\/actions\/runs\/(\d+)\/artifacts$/);
    if (artifacts) {
      const index = Number(artifacts[1]) - 1000;
      return { ok: true, json: async () => ({ artifacts: [{ name: `site-inputs-${shas[index]}`, expired: false }] }) };
    }
    if (route.includes("/jobs?")) return { ok: true, json: async () => ({ jobs: [BUNDLE_JOB] }) };
    if (route.includes("/actions/runs/")) return { ok: true, json: async () => RUN };
    throw new Error(`unexpected route ${route}`);
  };
  return calls;
}

function orderCompare(order, diverged = []) {
  const rank = (value) => order.indexOf(value);
  return async (base, head) => {
    if (diverged.includes(base) || diverged.includes(head)) return "diverged";
    if (base === head) return "identical";
    return rank(head) > rank(base) ? "ahead" : "behind";
  };
}

test("the bundle with the newest core commit wins over the newest run creation time", async () => {
  const order = [sha("1"), sha("2"), sha("3")];
  stubRecentRuns([order[1], order[0], order[2], order[0]]);
  const found = await newestBundle({}, { compare: orderCompare(order) });
  assert.equal(found.artifact.name, `site-inputs-${order[2]}`);
  assert.equal(found.runId, "1002");
});

test("the newest-created bundle wins when it is also the newest commit", async () => {
  const order = [sha("1"), sha("2")];
  stubRecentRuns([order[1], order[0]]);
  const found = await newestBundle({}, { compare: orderCompare(order) });
  assert.equal(found.runId, "1000");
});

test("diverged candidate bundles fail closed with the diverged-bundle class", async () => {
  const order = [sha("1"), sha("2"), sha("3")];
  stubRecentRuns([order[0], order[1], order[2]]);
  await assert.rejects(newestBundle({}, { compare: orderCompare(order, [order[1]]) }), /diverged-bundle/);
});

test("an unknown compare status fails closed", async () => {
  await assert.rejects(
    newestByCommitOrder([{ coreSha: sha("1") }, { coreSha: sha("2") }], async () => "unknown"),
    /returned status unknown/,
  );
});

test("a failed compare request fails the selection", async () => {
  stubRecentRuns([sha("1"), sha("2")]);
  const compareFetch = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url).includes("/compare/") ? { ok: false, status: 404 } : compareFetch(url);
  await assert.rejects(newestBundle({}), /returned 404/);
});

test("selection makes a bounded number of API calls", async () => {
  const order = Array.from({ length: 10 }, (_, index) => String(index).repeat(40));
  const calls = stubRecentRuns([...order].reverse());
  await newestBundle({}, { compare: orderCompare(order) });
  assert.equal(calls.length, 11);
});

test("a dispatched bundle with a newer descendant is replaced by the newest descendant", async () => {
  const order = [sha("1"), sha("2"), sha("3")];
  const dispatched = { SITE_INPUTS_RUN_ID: "1001" };
  stubRecentRuns([order[1], order[0], order[2]]);
  const notices = [];
  const log = console.log;
  console.log = (line) => notices.push(String(line));
  let found;
  try {
    found = await newestBundle(dispatched, { compare: orderCompare(order), maxWaitMs: 1000 });
  } finally {
    console.log = log;
  }
  assert.equal(found.artifact.name, `site-inputs-${order[2]}`);
  assert.equal(found.replaced, order[0]);
  assert.ok(notices.some((line) => line.includes(order[0]) && line.includes(order[2])));
});

test("a dispatched bundle that is the newest, or whose neighbours are behind or diverged, is kept", async () => {
  const order = [sha("1"), sha("2"), sha("3")];
  stubRecentRuns([order[0], order[1], order[2]]);
  const found = await newestBundle({ SITE_INPUTS_RUN_ID: "1002" }, { compare: orderCompare(order), maxWaitMs: 1000 });
  assert.equal(found.runId, "1002");
  assert.equal(found.replaced, undefined);
  stubRecentRuns([order[0], order[1], order[2]]);
  const kept = await newestBundle({ SITE_INPUTS_RUN_ID: "1000" }, { compare: orderCompare(order, [order[2]]), maxWaitMs: 1000 });
  assert.equal(kept.runId, "1001");
});
