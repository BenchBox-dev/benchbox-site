import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseStatusDescription, receiptSha, type Receipt } from "./receipt.ts";
import { downloadArtifact } from "../../scripts/github-download.mjs";

export type Api = (route: string, init?: { method?: string; body?: unknown }) => Promise<{ status: number; body: unknown }>;

export function githubApi(token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN): Api {
  return async (route, init = {}) => {
    const response = await fetch(`https://api.github.com/${route.replace(/^\//, "")}`, {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: response.status, body };
  };
}

export type RecordedReceipt = { deploymentId: number; sha: string; runId: string; target: string | null };

export async function recordedReceipts(
  api: Api,
  repo: string,
  environment = "github-pages",
  target?: string,
  load?: (runId: string) => Receipt,
): Promise<RecordedReceipt[]> {
  const recorded: RecordedReceipt[] = [];
  for (let page = 1; ; page += 1) {
    const deployments = await api(`repos/${repo}/deployments?environment=${environment}&per_page=100&page=${page}`);
    if (deployments.status !== 200) throw new Error(`listing deployments failed closed (HTTP ${deployments.status})`);
    const rows = deployments.body as { id: number }[];
    if (rows.length === 0) break;
    for (const deployment of rows) {
      const statuses = await api(`repos/${repo}/deployments/${deployment.id}/statuses?per_page=100`);
      if (statuses.status !== 200)
        throw new Error(`reading deployment ${deployment.id} statuses failed closed (HTTP ${statuses.status})`);
      for (const status of statuses.body as { state: string; description: string | null }[]) {
        const parsed = status.state === "success" ? parseStatusDescription(status.description) : null;
        if (!parsed) continue;
        const resolved =
          parsed.target ??
          (load
            ? verifiedReceipt({ deploymentId: deployment.id, sha: parsed.sha, runId: parsed.runId, target: null }, load)
                .target
            : null);
        if (target === undefined || resolved === target) {
          recorded.push({ deploymentId: deployment.id, sha: parsed.sha, runId: parsed.runId, target: resolved });
        }
        break;
      }
    }
  }
  return recorded;
}

export function receiptArtifactName(runId: string): string {
  return `site-deploy-receipt-${runId}`;
}

export function siteArtifactName(runId: string): string {
  return `site-artifact-${runId}`;
}

export function downloadReceipt(
  repo: string,
  runId: string,
  options: { sleep?: (ms: number) => void; log?: (msg: string) => void } = {},
): Receipt {
  const dir = mkdtempSync(path.join(tmpdir(), "site-receipt-"));
  try {
    downloadArtifact(repo, runId, receiptArtifactName(runId), dir, options);
    const file = readdirSync(dir).find((name) => name.endsWith(".json"));
    if (!file) throw new Error(`receipt artifact of run ${runId} holds no JSON`);
    return JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Receipt;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function verifiedReceipt(recorded: RecordedReceipt, load: (runId: string) => Receipt): Receipt {
  const receipt = load(recorded.runId);
  if (receiptSha(receipt) !== recorded.sha) throw new Error(`receipt of run ${recorded.runId} does not match its recorded sha256 ${recorded.sha}`);
  if (receipt.run_id !== recorded.runId) throw new Error(`receipt run ${receipt.run_id} does not match the recorded run ${recorded.runId}`);
  return receipt;
}
