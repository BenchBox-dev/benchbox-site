import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseStatusDescription, receiptSha, type Receipt } from "./receipt.ts";
import { downloadArtifact } from "../../scripts/github-download.mjs";

export type Api = (route: string, init?: { method?: string; body?: unknown }) => Promise<{ status: number; body: unknown }>;

export type GithubApiOptions = {
  fetch?: typeof fetch;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
};

const RATE_LIMIT_HEADERS = ["limit", "remaining", "used", "reset", "resource"] as const;
const NETWORK_RETRIES = 2;
const NETWORK_ERROR_CODES = new Set(["UND_ERR_SOCKET", "ECONNRESET"]);

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error.cause as { code?: string } | undefined)?.code ?? (error as { code?: string }).code;
  return error.message === "fetch failed" || (code !== undefined && NETWORK_ERROR_CODES.has(code));
}

function failureMessage(body: unknown): string {
  const message = typeof body === "string" ? body : ((body as { message?: unknown } | null)?.message ?? JSON.stringify(body));
  return String(message).slice(0, 200);
}

function describeFailure(method: string, route: string, response: Response, body: unknown): string {
  const limits = RATE_LIMIT_HEADERS.map((name) => `${name}=${response.headers.get(`x-ratelimit-${name}`) ?? "-"}`).join(" ");
  return `github api ${method} ${route} -> HTTP ${response.status} ratelimit ${limits} retry-after=${response.headers.get("retry-after") ?? "-"} message=${JSON.stringify(failureMessage(body))}`;
}

export function githubApi(token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN, options: GithubApiOptions = {}): Api {
  const doFetch = options.fetch ?? fetch;
  const log = options.log ?? ((line: string) => console.error(line));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return async (route, init = {}) => {
    const method = init.method ?? "GET";
    const send = () =>
      doFetch(`https://api.github.com/${route.replace(/^\//, "")}`, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
      });
    let response: Response;
    for (let attempt = 0; ; attempt += 1) {
      try {
        response = await send();
        break;
      } catch (error) {
        if (method !== "GET" || attempt >= NETWORK_RETRIES || !isNetworkError(error)) throw error;
        await sleep(500 * 2 ** attempt);
      }
    }
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (response.status < 200 || response.status >= 300) log(describeFailure(method, route, response, body));
    return { status: response.status, body };
  };
}

export type RecordedReceipt = { deploymentId: number; sha: string; runId: string; target: string | null };

export type LookupStats = { rest: number; loads: number };

export class ReceiptLookupBoundError extends Error {
  constructor(environment: string, target: string | undefined, pages: number) {
    super(
      `no ${target ? `${target} ` : ""}receipt was found on the newest ${pages} page(s) of ${environment} deployments; ` +
        "refusing to treat the deployed generation as unknown",
    );
    this.name = "ReceiptLookupBoundError";
  }
}

export const RECEIPT_LOOKUP_MAX_PAGES = 3;

export function countingLookup(api: Api, load: (runId: string) => Receipt): { api: Api; load: (runId: string) => Receipt; stats: LookupStats } {
  const stats: LookupStats = { rest: 0, loads: 0 };
  return {
    stats,
    api: (route, init) => {
      stats.rest += 1;
      return api(route, init);
    },
    load: (runId) => {
      stats.loads += 1;
      return load(runId);
    },
  };
}

export function lookupSummary(stats: LookupStats): string {
  return `deploy lookup: ${stats.rest} REST calls, ${stats.loads} receipt loads`;
}

export async function latestRecordedReceipt(
  api: Api,
  repo: string,
  environment = "github-pages",
  target?: string,
  load?: (runId: string) => Receipt,
  options: { maxPages?: number } = {},
): Promise<{ recorded: RecordedReceipt; receipt: Receipt | null } | null> {
  const maxPages = options.maxPages ?? RECEIPT_LOOKUP_MAX_PAGES;
  for (let page = 1; page <= maxPages; page += 1) {
    const deployments = await api(`repos/${repo}/deployments?environment=${environment}&per_page=100&page=${page}`);
    if (deployments.status !== 200) throw new Error(`listing deployments failed closed (HTTP ${deployments.status})`);
    const rows = deployments.body as { id: number }[];
    for (const deployment of rows) {
      const statuses = await api(`repos/${repo}/deployments/${deployment.id}/statuses?per_page=100`);
      if (statuses.status !== 200)
        throw new Error(`reading deployment ${deployment.id} statuses failed closed (HTTP ${statuses.status})`);
      for (const status of statuses.body as { state: string; description: string | null }[]) {
        const parsed = status.state === "success" ? parseStatusDescription(status.description) : null;
        if (!parsed) continue;
        const recorded: RecordedReceipt = { deploymentId: deployment.id, sha: parsed.sha, runId: parsed.runId, target: parsed.target ?? null };
        if (parsed.target !== undefined) {
          if (target === undefined || parsed.target === target) return { recorded, receipt: null };
        } else if (target === undefined) {
          return { recorded, receipt: null };
        } else if (load) {
          const verified = verifiedReceipt(recorded, load);
          if (verified.target === target) return { recorded: { ...recorded, target: verified.target }, receipt: verified };
        }
        break;
      }
    }
    if (rows.length < 100) return null;
  }
  throw new ReceiptLookupBoundError(environment, target, maxPages);
}

export async function recordedReceiptForRun(
  api: Api,
  repo: string,
  environment: string,
  runId: string,
  target: string | undefined,
  load: (runId: string) => Receipt,
): Promise<Receipt> {
  const receipt = load(runId);
  if (receipt.run_id !== runId) throw new Error(`receipt run ${receipt.run_id} does not match the requested run ${runId}`);
  if (typeof receipt.deployment_id !== "number") throw new Error(`receipt of run ${runId} names no deployment`);
  if (target !== undefined && receipt.target !== target) {
    throw new Error(`receipt of run ${runId} was recorded for target ${receipt.target}, not ${target}`);
  }
  const deployment = await api(`repos/${repo}/deployments/${receipt.deployment_id}`);
  if (deployment.status !== 200) throw new Error(`reading deployment ${receipt.deployment_id} failed closed (HTTP ${deployment.status})`);
  if ((deployment.body as { environment?: string }).environment !== environment) {
    throw new Error(`deployment ${receipt.deployment_id} of run ${runId} is not a ${environment} deployment`);
  }
  const statuses = await api(`repos/${repo}/deployments/${receipt.deployment_id}/statuses?per_page=100`);
  if (statuses.status !== 200)
    throw new Error(`reading deployment ${receipt.deployment_id} statuses failed closed (HTTP ${statuses.status})`);
  const sha = receiptSha(receipt);
  const recorded = (statuses.body as { state: string; description: string | null }[]).some((status) => {
    const parsed = status.state === "success" ? parseStatusDescription(status.description) : null;
    return parsed !== null && parsed.runId === runId && parsed.sha === sha;
  });
  if (!recorded) throw new Error(`deployment ${receipt.deployment_id} has no success status recording run ${runId} with receipt sha256 ${sha}`);
  return receipt;
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
