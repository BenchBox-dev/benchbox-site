import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countingLookup,
  githubApi,
  latestRecordedReceipt,
  ReceiptLookupBoundError,
  recordedReceiptForRun,
  type Api,
} from "../lib/github.ts";
import { receiptSha, statusDescription, type Receipt } from "../lib/receipt.ts";
import { receipt } from "./helpers.ts";

const REPO = "BenchBox-dev/benchbox-site";
type Status = { state: string; description: string | null };

function productionReceipt(runId: string, coreSha: string, deploymentId: number | null = null): Receipt {
  return receipt({ run_id: runId, target: "production", core_sha: coreSha, deployment_id: deploymentId });
}

function rehearsalReceipt(runId: string, coreSha: string, deploymentId: number | null = null): Receipt {
  return receipt({ run_id: runId, target: "rehearsal", core_sha: coreSha, deployment_id: deploymentId });
}

function stubApi(
  pages: { id: number }[][],
  statuses: Record<number, Status[]>,
  environments: Record<number, string> = {},
): Api {
  return async (route) => {
    const list = route.match(/deployments\?environment=github-pages&per_page=100&page=(\d+)/);
    if (list) return { status: 200, body: pages[Number(list[1]) - 1] ?? [] };
    const many = route.match(/deployments\/(\d+)\/statuses/);
    if (many) return { status: 200, body: statuses[Number(many[1])] ?? [] };
    const one = route.match(/deployments\/(\d+)$/);
    if (one) return { status: 200, body: { id: Number(one[1]), environment: environments[Number(one[1])] ?? "github-pages" } };
    throw new Error(`unexpected route ${route}`);
  };
}

function history(count: number, newest: Receipt, older: Receipt) {
  const ids = Array.from({ length: count }, (_, index) => count - index);
  const pages: { id: number }[][] = [];
  for (let at = 0; at < ids.length; at += 100) pages.push(ids.slice(at, at + 100).map((id) => ({ id })));
  const statuses: Record<number, Status[]> = {};
  for (const id of ids) {
    const value = id === count ? newest : { ...older, run_id: String(1000 + id) };
    statuses[id] = [{ state: "success", description: statusDescription(value) }];
  }
  return { pages, statuses };
}

test("a newer rehearsal receipt does not change the production baseline", async () => {
  const rehearsal = rehearsalReceipt("109", "b".repeat(40));
  const production = productionReceipt("108", "a".repeat(40));
  const api = stubApi([[{ id: 9 }, { id: 8 }]], {
    9: [{ state: "success", description: statusDescription(rehearsal) }],
    8: [{ state: "success", description: statusDescription(production) }],
  });
  const forProduction = await latestRecordedReceipt(api, REPO, "github-pages", "production");
  assert.equal(forProduction?.recorded.runId, "108");
  assert.equal(forProduction?.recorded.target, "production");
  const forRehearsal = await latestRecordedReceipt(api, REPO, "github-pages", "rehearsal");
  assert.equal(forRehearsal?.recorded.runId, "109");
});

test("a description without a target is resolved from its verified receipt, and only until the first match", async () => {
  const production = productionReceipt("108", "a".repeat(40));
  const legacy = `site-deploy receipt sha256:${receiptSha(production)} run:108`;
  const api = stubApi([[{ id: 9 }, { id: 8 }]], {
    9: [{ state: "success", description: statusDescription(productionReceipt("109", "b".repeat(40))) }],
    8: [{ state: "success", description: legacy }],
  });
  const loaded: string[] = [];
  const load = (runId: string) => {
    loaded.push(runId);
    return production;
  };
  const found = await latestRecordedReceipt(api, REPO, "github-pages", "production", load);
  assert.equal(found?.recorded.runId, "109");
  assert.deepEqual(loaded, []);

  const legacyOnly = stubApi([[{ id: 8 }]], { 8: [{ state: "success", description: legacy }] });
  const resolved = await latestRecordedReceipt(legacyOnly, REPO, "github-pages", "production", load);
  assert.deepEqual(loaded, ["108"]);
  assert.equal(resolved?.recorded.target, "production");
  assert.equal(resolved?.receipt?.run_id, "108");
  assert.equal(await latestRecordedReceipt(legacyOnly, REPO, "github-pages", "rehearsal", load), null);
});

test("lookup cost is the same at 100 and 1,000 deployments", async () => {
  const production = productionReceipt("5000", "a".repeat(40));
  const costs: string[] = [];
  for (const count of [100, 1000]) {
    const { pages, statuses } = history(count, production, rehearsalReceipt("1", "c".repeat(40)));
    const counted = countingLookup(stubApi(pages, statuses), () => production);
    const found = await latestRecordedReceipt(counted.api, REPO, "github-pages", "production", counted.load);
    assert.equal(found?.recorded.runId, "5000");
    costs.push(JSON.stringify(counted.stats));
  }
  assert.equal(costs[0], costs[1]);
  assert.deepEqual(JSON.parse(costs[0]), { rest: 2, loads: 0 });
});

test("a lookup reaches an older match behind other targets without loading anything", async () => {
  const production = productionReceipt("5000", "a".repeat(40));
  const ids = Array.from({ length: 250 }, (_, index) => 250 - index);
  const pages = [ids.slice(0, 100), ids.slice(100, 200), ids.slice(200)].map((page) => page.map((id) => ({ id })));
  const statuses: Record<number, Status[]> = {};
  for (const id of ids) {
    const other = id === 5 ? production : rehearsalReceipt(String(id), "c".repeat(40));
    statuses[id] = [{ state: "success", description: statusDescription(other) }];
  }
  const counted = countingLookup(stubApi(pages, statuses), () => {
    throw new Error("must not load");
  });
  const found = await latestRecordedReceipt(counted.api, REPO, "github-pages", "production", counted.load);
  assert.equal(found?.recorded.deploymentId, 5);
  assert.equal(counted.stats.loads, 0);
});

test("load failures on unrelated runs do not break the lookup", async () => {
  const production = productionReceipt("108", "a".repeat(40));
  const { pages, statuses } = history(1000, production, rehearsalReceipt("1", "c".repeat(40)));
  const load = (runId: string) => {
    if (runId !== "108") throw new Error(`artifact of run ${runId} expired`);
    return production;
  };
  const found = await latestRecordedReceipt(stubApi(pages, statuses), REPO, "github-pages", "production", load);
  assert.equal(found?.recorded.runId, "108");
});

test("no match within the page bound throws a named error, and an exhausted history returns null", async () => {
  const rehearsal = rehearsalReceipt("1", "c".repeat(40));
  const { pages, statuses } = history(450, rehearsal, rehearsal);
  await assert.rejects(
    latestRecordedReceipt(stubApi(pages, statuses), REPO, "github-pages", "production", undefined, { maxPages: 3 }),
    (error: Error) => error instanceof ReceiptLookupBoundError && /newest 3 page/.test(error.message),
  );
  const small = history(40, rehearsal, rehearsal);
  assert.equal(await latestRecordedReceipt(stubApi(small.pages, small.statuses), REPO, "github-pages", "production"), null);
  assert.equal(await latestRecordedReceipt(stubApi([], {}), REPO, "github-pages", "production"), null);
});

test("rollback reads only the receipt's own deployment, even beyond the first 100", async () => {
  const production = productionReceipt("105", "a".repeat(40), 5);
  const seen: string[] = [];
  const inner = stubApi([[], []], { 5: [{ state: "success", description: statusDescription(production) }] });
  const api: Api = (route, init) => {
    seen.push(route);
    return inner(route, init);
  };
  const loaded: string[] = [];
  const found = await recordedReceiptForRun(api, REPO, "github-pages", "105", "production", (id) => {
    loaded.push(id);
    return production;
  });
  assert.equal(found.run_id, "105");
  assert.deepEqual(loaded, ["105"]);
  assert.deepEqual(seen, [`repos/${REPO}/deployments/5`, `repos/${REPO}/deployments/5/statuses?per_page=100`]);
});

test("rollback refuses a wrong environment, a missing status, a different sha or a different target", async () => {
  const production = productionReceipt("105", "a".repeat(40), 5);
  const good: Status = { state: "success", description: statusDescription(production) };
  const load = () => production;
  await assert.rejects(
    recordedReceiptForRun(stubApi([], { 5: [good] }, { 5: "production" }), REPO, "github-pages", "105", "production", load),
    /not a github-pages deployment/,
  );
  await assert.rejects(
    recordedReceiptForRun(stubApi([], { 5: [{ state: "failure", description: good.description }] }), REPO, "github-pages", "105", "production", load),
    /no success status/,
  );
  const otherSha = `site-deploy receipt sha256:${"9".repeat(64)} run:105 target:production`;
  await assert.rejects(
    recordedReceiptForRun(stubApi([], { 5: [{ state: "success", description: otherSha }] }), REPO, "github-pages", "105", "production", load),
    /no success status/,
  );
  await assert.rejects(
    recordedReceiptForRun(stubApi([], { 5: [good] }), REPO, "github-pages", "105", "rehearsal", load),
    /recorded for target production, not rehearsal/,
  );
  await assert.rejects(
    recordedReceiptForRun(stubApi([], { 5: [good] }), REPO, "github-pages", "105", "production", () => ({ ...production, run_id: "106" })),
    /does not match the requested run/,
  );
});

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

test("every non-2xx response is logged with rate-limit headers and a truncated message", async () => {
  const lines: string[] = [];
  const api = githubApi("t", {
    fetch: async () =>
      response(
        403,
        { message: `API rate limit exceeded ${"x".repeat(400)}` },
        {
          "x-ratelimit-limit": "1000",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-used": "1000",
          "x-ratelimit-reset": "1761900000",
          "x-ratelimit-resource": "core",
          "retry-after": "60",
        },
      ),
    log: (line) => lines.push(line),
  });
  const result = await api("repos/a/b/deployments?per_page=1");
  assert.equal(result.status, 403);
  assert.equal(lines.length, 1);
  const [line] = lines;
  for (const part of [
    "GET",
    "repos/a/b/deployments?per_page=1",
    "HTTP 403",
    "limit=1000",
    "remaining=0",
    "used=1000",
    "reset=1761900000",
    "resource=core",
    "retry-after=60",
  ])
    assert.ok(line.includes(part), `${part} in ${line}`);
  const message = JSON.parse(line.slice(line.indexOf("message=") + "message=".length)) as string;
  assert.equal(message.length, 200);
  await githubApi("t", { fetch: async () => response(200, {}), log: (l) => lines.push(l) })("x");
  assert.equal(lines.length, 1);
});

function networkFailure(message: string, code?: string): Error {
  return Object.assign(new Error(message), code ? { cause: { code } } : {});
}

test("GET retries network errors at most twice with backoff", async () => {
  for (const [message, code] of [["fetch failed", "UND_ERR_SOCKET"], ["other", "ECONNRESET"], ["fetch failed", undefined]] as const) {
    let calls = 0;
    const sleeps: number[] = [];
    const api = githubApi("t", {
      fetch: async () => {
        calls += 1;
        if (calls < 3) throw networkFailure(message, code);
        return response(200, { ok: true });
      },
      sleep: async (ms) => void sleeps.push(ms),
    });
    assert.deepEqual((await api("x")).body, { ok: true });
    assert.equal(calls, 3);
    assert.deepEqual(sleeps, [500, 1000]);
  }
  let calls = 0;
  const failing = githubApi("t", {
    fetch: async () => {
      calls += 1;
      throw networkFailure("fetch failed", "UND_ERR_SOCKET");
    },
    sleep: async () => {},
  });
  await assert.rejects(failing("x"), /fetch failed/);
  assert.equal(calls, 3);
});

test("GET does not retry HTTP errors, other errors or non-GET requests", async () => {
  let calls = 0;
  const http = githubApi("t", {
    fetch: async () => {
      calls += 1;
      return response(503, { message: "down" });
    },
    log: () => {},
    sleep: async () => {},
  });
  assert.equal((await http("x")).status, 503);
  assert.equal(calls, 1);
  calls = 0;
  const other = githubApi("t", {
    fetch: async () => {
      calls += 1;
      throw new Error("bad url");
    },
    sleep: async () => {},
  });
  await assert.rejects(other("x"), /bad url/);
  assert.equal(calls, 1);
  calls = 0;
  const post = githubApi("t", {
    fetch: async () => {
      calls += 1;
      throw networkFailure("fetch failed", "ECONNRESET");
    },
    sleep: async () => {},
  });
  await assert.rejects(post("x", { method: "POST", body: {} }), /fetch failed/);
  assert.equal(calls, 1);
});
