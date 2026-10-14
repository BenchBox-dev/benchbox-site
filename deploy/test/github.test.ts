import { test } from "node:test";
import assert from "node:assert/strict";
import { recordedReceipts, type Api } from "../lib/github.ts";
import { receiptSha, statusDescription, type Receipt } from "../lib/receipt.ts";
import { receipt } from "./helpers.ts";

const REPO = "BenchBox-dev/benchbox-site";

function productionReceipt(runId: string, coreSha: string): Receipt {
  return receipt({ run_id: runId, target: "production", core_sha: coreSha, deployment_id: null });
}

function rehearsalReceipt(runId: string, coreSha: string): Receipt {
  return receipt({ run_id: runId, target: "rehearsal", core_sha: coreSha, deployment_id: null });
}

function stubApi(pages: { id: number }[][], statuses: Record<number, { state: string; description: string | null }[]>): Api {
  return async (route) => {
    const list = route.match(/deployments\?environment=github-pages&per_page=100&page=(\d+)/);
    if (list) {
      const page = pages[Number(list[1]) - 1] ?? [];
      return { status: 200, body: page };
    }
    const one = route.match(/deployments\/(\d+)\/statuses/);
    if (one) return { status: 200, body: statuses[Number(one[1])] ?? [] };
    throw new Error(`unexpected route ${route}`);
  };
}

test("a newer rehearsal receipt does not change the production baseline", async () => {
  const rehearsal = rehearsalReceipt("109", "b".repeat(40));
  const production = productionReceipt("108", "a".repeat(40));
  const api = stubApi([[{ id: 9 }, { id: 8 }]], {
    9: [{ state: "success", description: statusDescription(rehearsal) }],
    8: [{ state: "success", description: statusDescription(production) }],
  });
  const load = (runId: string) => (runId === "109" ? rehearsal : production);
  const forProduction = await recordedReceipts(api, REPO, "github-pages", "production", load);
  assert.deepEqual(
    forProduction.map((entry) => entry.runId),
    ["108"],
  );
  assert.equal(forProduction[0].target, "production");
  const forRehearsal = await recordedReceipts(api, REPO, "github-pages", "rehearsal", load);
  assert.deepEqual(
    forRehearsal.map((entry) => entry.runId),
    ["109"],
  );
});

test("a description without a target resolves it from the verified receipt", async () => {
  const production = productionReceipt("108", "a".repeat(40));
  const legacy = `site-deploy receipt sha256:${receiptSha(production)} run:108`;
  const api = stubApi([[{ id: 8 }]], { 8: [{ state: "success", description: legacy }] });
  let loaded: string[] = [];
  const load = (runId: string) => {
    loaded.push(runId);
    return production;
  };
  const forProduction = await recordedReceipts(api, REPO, "github-pages", "production", load);
  assert.deepEqual(loaded, ["108"]);
  assert.deepEqual(
    forProduction.map((entry) => entry.runId),
    ["108"],
  );
  assert.equal(forProduction[0].target, "production");
  const forRehearsal = await recordedReceipts(api, REPO, "github-pages", "rehearsal", load);
  assert.deepEqual(forRehearsal, []);
});

test("rollback lookup finds a receipt beyond the first page", async () => {
  const production = productionReceipt("105", "a".repeat(40));
  const first = Array.from({ length: 100 }, (_, index) => ({ id: 1000 + index }));
  const api = stubApi([first, [{ id: 5 }]], {
    5: [{ state: "success", description: statusDescription(production) }],
  });
  const recorded = await recordedReceipts(api, REPO, "github-pages", "production", () => production);
  const found = recorded.find((entry) => entry.runId === "105") ?? null;
  assert.ok(found);
  assert.equal(found.deploymentId, 5);
});
