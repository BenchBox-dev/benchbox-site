import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseStatusDescription, receiptSha, type Receipt } from "./receipt.ts";

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

export type RecordedReceipt = { deploymentId: number; sha: string; runId: string };

export async function recordedReceipts(api: Api, repo: string, environment = "github-pages"): Promise<RecordedReceipt[]> {
  const deployments = await api(`repos/${repo}/deployments?environment=${environment}&per_page=100`);
  if (deployments.status !== 200) throw new Error(`listing deployments failed closed (HTTP ${deployments.status})`);
  const recorded: RecordedReceipt[] = [];
  for (const deployment of deployments.body as { id: number }[]) {
    const statuses = await api(`repos/${repo}/deployments/${deployment.id}/statuses?per_page=100`);
    if (statuses.status !== 200) throw new Error(`reading deployment ${deployment.id} statuses failed closed (HTTP ${statuses.status})`);
    for (const status of statuses.body as { state: string; description: string | null }[]) {
      const parsed = status.state === "success" ? parseStatusDescription(status.description) : null;
      if (parsed) {
        recorded.push({ deploymentId: deployment.id, ...parsed });
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

export function downloadReceipt(repo: string, runId: string): Receipt {
  const dir = mkdtempSync(path.join(tmpdir(), "site-receipt-"));
  execFileSync("gh", ["run", "download", runId, "-R", repo, "-n", receiptArtifactName(runId), "-D", dir], { stdio: "inherit" });
  const file = readdirSync(dir).find((name) => name.endsWith(".json"));
  if (!file) throw new Error(`receipt artifact of run ${runId} holds no JSON`);
  return JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Receipt;
}

export function verifiedReceipt(recorded: RecordedReceipt, load: (runId: string) => Receipt): Receipt {
  const receipt = load(recorded.runId);
  if (receiptSha(receipt) !== recorded.sha) throw new Error(`receipt of run ${recorded.runId} does not match its recorded sha256 ${recorded.sha}`);
  if (receipt.run_id !== recorded.runId) throw new Error(`receipt run ${receipt.run_id} does not match the recorded run ${recorded.runId}`);
  return receipt;
}
