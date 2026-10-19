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

export const DOWNLOAD_RETRY_INTERVALS_MS = [5000, 15000, 45000];
export const MAX_DOWNLOAD_ATTEMPTS = 3;

export function isRetryableDownloadError(error: unknown): boolean {
  if (!error) return false;
  let stderr = "";
  if (typeof error === "object" && "stderr" in error && error.stderr) {
    stderr = String(error.stderr);
  }
  const baseMessage = error instanceof Error ? error.message : String(error);
  const message = `${baseMessage} ${stderr}`.toLowerCase();
  if (/http\s+4\d\d\b/.test(message) || /\b4\d\d\s+(not found|forbidden|unauthorized|bad request)\b/i.test(message) || /\b40[0-9]\b/.test(message)) {
    return false;
  }
  if (message.includes("digest") || message.includes("mismatch") || message.includes("gate failure") || message.includes("gate failed")) {
    return false;
  }
  if (
    /http\s+5\d\d\b/.test(message) ||
    /\b5\d\d\s+(egress|server error|bad gateway|gateway timeout)\b/i.test(message) ||
    /\b50[0-9]\b/.test(message) ||
    message.includes("egress is over the account limit")
  ) {
    return true;
  }
  if (
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("enotfound") ||
    message.includes("network error") ||
    message.includes("fetch failed") ||
    message.includes("socket hang up")
  ) {
    return true;
  }
  return false;
}

export function downloadWithRetry<T>(
  runner: () => T,
  options: {
    maxAttempts?: number;
    intervals?: number[];
    sleep?: (ms: number) => void;
    log?: (msg: string) => void;
  } = {},
): T {
  const maxAttempts = options.maxAttempts ?? MAX_DOWNLOAD_ATTEMPTS;
  const intervals = options.intervals ?? DOWNLOAD_RETRY_INTERVALS_MS;
  const sleep = options.sleep ?? ((ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms));
  const log = options.log ?? console.warn;

  let attempt = 1;
  while (true) {
    try {
      return runner();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableDownloadError(error)) {
        throw error;
      }
      const delay = intervals[attempt - 1] ?? intervals[intervals.length - 1];
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`receipt download failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay / 1000}s: ${errorMessage}`);
      sleep(delay);
      attempt += 1;
    }
  }
}

export function downloadReceipt(
  repo: string,
  runId: string,
  options: {
    runner?: () => void;
    sleep?: (ms: number) => void;
    log?: (msg: string) => void;
  } = {},
): Receipt {
  const dir = mkdtempSync(path.join(tmpdir(), "site-receipt-"));
  downloadWithRetry(
    () => {
      if (options.runner) {
        options.runner();
      } else {
        execFileSync("gh", ["run", "download", runId, "-R", repo, "-n", receiptArtifactName(runId), "-D", dir], {
          stdio: ["ignore", "pipe", "pipe"],
        });
      }
    },
    { sleep: options.sleep, log: options.log },
  );
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
