import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { uiVersionFromSource } from "./gates/explorer-compat.ts";
import { runGates } from "./gates/index.ts";
import type { BrokenLink } from "./gates/links.ts";
import { SNAPSHOT_PATH, snapshotSha } from "./gates/snapshot-digest.ts";
import { canonicalDigest } from "./lib/canonical-digest.ts";
import { downloadReceipt, githubApi, recordedReceipts, verifiedReceipt } from "./lib/github.ts";
import { checksumManifest, probe } from "./lib/probe.ts";
import { latencySeconds, receiptBytes, receiptSha, RECEIPT_SCHEMA, statusDescription, type Receipt } from "./lib/receipt.ts";
import { recheckErrors } from "./lib/recheck.ts";
import { markRehearsal } from "./lib/rehearsal.ts";
import { chainErrors, freshnessErrors, type Deployed } from "./lib/resolve.ts";
import { automaticRollback, rollbackTargetErrors } from "./lib/rollback.ts";
import { treeDigest } from "../website/src/lib/tree-digest.ts";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const WORK = path.resolve(process.env.DEPLOY_WORK ?? path.join(ROOT, "deploy-work"));
const SITE_DIR = path.resolve(process.env.SITE_DIR ?? path.join(ROOT, "website", "dist"));
const SITE_INPUTS = path.resolve(process.env.SITE_INPUTS ?? path.join(ROOT, ".site-inputs"));
const CORE_REPO = process.env.CORE_REPO ?? "BenchBox-dev/BenchBox";
const SITE_REPO = process.env.GITHUB_REPOSITORY ?? "BenchBox-dev/benchbox-site";
type Mode = Receipt["mode"];

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function writeWork(name: string, value: unknown): void {
  mkdirSync(WORK, { recursive: true });
  writeFileSync(path.join(WORK, name), `${JSON.stringify(value, null, 2)}\n`);
}

function output(name: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, { flag: "a" });
  console.log(`${name}=${value}`);
}

function failWith(errors: string[]): never {
  for (const error of errors) console.error(`deploy: ${error}`);
  process.exit(1);
}

type Resolution = {
  mode: Mode;
  core_sha: string;
  corpus_sha: string;
  bundle_digest: string;
  snapshot_read_model_version: number;
  deployed: (Deployed & { receipt_sha: string; snapshot_sha256: string; snapshot_canonical_sha256: string | null; ui: number; snapshot: number; run_id: string }) | null;
  rollback_target: Receipt | null;
};

async function currentDeployed(): Promise<{ receipt: Receipt; sha: string } | null> {
  const recorded = await recordedReceipts(githubApi(), SITE_REPO);
  if (recorded.length === 0) return null;
  return { receipt: verifiedReceipt(recorded[0], (runId) => downloadReceipt(SITE_REPO, runId)), sha: recorded[0].sha };
}

async function resolve(): Promise<void> {
  const mode = (process.env.DEPLOY_MODE ?? "deploy") as Mode;
  const current = await currentDeployed();
  if (current) {
    mkdirSync(WORK, { recursive: true });
    writeFileSync(path.join(WORK, "deployed-receipt.json"), receiptBytes(current.receipt));
  }
  const deployed = current
    ? {
        core_sha: current.receipt.core_sha,
        corpus_sha: current.receipt.corpus_sha,
        receipt_sha: current.sha,
        snapshot_sha256: current.receipt.snapshot_sha256,
        snapshot_canonical_sha256: current.receipt.snapshot_canonical_sha256 ?? null,
        ui: current.receipt.explorer_read_model_version,
        snapshot: current.receipt.snapshot_read_model_version,
        run_id: current.receipt.run_id,
      }
    : null;
  if (mode === "rollback") {
    const runId = process.env.ROLLBACK_RUN_ID ?? "";
    if (!/^\d+$/.test(runId)) failWith(["rollback needs a numeric receipt run id"]);
    const recorded = (await recordedReceipts(githubApi(), SITE_REPO)).find((entry) => entry.runId === runId) ?? null;
    const target = recorded ? verifiedReceipt(recorded, (id) => downloadReceipt(SITE_REPO, id)) : null;
    const errors = rollbackTargetErrors(target, runId);
    if (errors.length > 0) failWith(errors);
    const restored = target as Receipt;
    writeWork("resolve.json", {
      mode,
      core_sha: restored.core_sha,
      corpus_sha: restored.corpus_sha,
      bundle_digest: restored.bundle_digest,
      snapshot_read_model_version: restored.snapshot_read_model_version,
      deployed,
      rollback_target: restored,
    } satisfies Resolution);
    output("core_sha", restored.core_sha);
    return;
  }
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "bundle-fetch.mjs")], { stdio: "inherit", env: process.env });
  const manifest = readJson<{ core_sha: string; corpus_sha: string }>(path.join(SITE_INPUTS, "manifest.json"));
  const fetched = readJson<{ digest: string }>(path.join(SITE_INPUTS, ".fetched.json"));
  const attestations = readJson<{ name: string; result: string; compared?: { base?: string } }[]>(path.join(SITE_INPUTS, "attestations.json"));
  const parity = attestations.find((entry) => entry.name === "validator_parity");
  const contract = readJson<{ read_model_version: number }>(path.join(SITE_INPUTS, "explorer", "contract.json"));
  const errors: string[] = [];
  if (deployed && mode === "deploy") {
    const compare = await githubApi()(`repos/${CORE_REPO}/compare/${deployed.core_sha}...${manifest.core_sha}`);
    errors.push(...freshnessErrors(deployed, { status: compare.status, body: compare.body as { status?: "ahead" } }));
  }
  errors.push(...chainErrors(deployed, { core_sha: manifest.core_sha, corpus_sha: manifest.corpus_sha, validator_parity: parity && { result: parity.result, base: parity.compared?.base } }));
  if (errors.length > 0) failWith(errors);
  writeWork("resolve.json", {
    mode,
    core_sha: manifest.core_sha,
    corpus_sha: manifest.corpus_sha,
    bundle_digest: fetched.digest,
    snapshot_read_model_version: contract.read_model_version,
    deployed,
    rollback_target: null,
  } satisfies Resolution);
  output("core_sha", manifest.core_sha);
}

async function gates(): Promise<void> {
  const resolution = readJson<Resolution>(path.join(WORK, "resolve.json"));
  const rollback = resolution.rollback_target;
  const uiVersion = rollback ? rollback.explorer_read_model_version : uiVersionFromSource(readFileSync(path.join(ROOT, "explorer", "src", "db.ts"), "utf8"));
  const allowance = readJson<BrokenLink[]>(path.join(ROOT, "inventory", "known-broken-links.json"));
  const originAllowlist = readJson<string[]>(path.join(ROOT, "deploy", "origin-allowlist.json")).map((pattern) => new RegExp(pattern));
  const host = process.env.SITE_HOST;
  const snapshot = path.join(SITE_DIR, SNAPSHOT_PATH);
  const canonical = existsSync(snapshot) ? await canonicalDigest(snapshot) : null;
  const report = runGates({
    siteDir: SITE_DIR,
    mode: resolution.mode,
    target: process.env.SITE_DEPLOY_TARGET ?? "",
    corpusSha: resolution.corpus_sha,
    uiVersion,
    snapshotVersion: resolution.snapshot_read_model_version,
    allowance,
    originAllowlist,
    extraHosts: host ? [host] : [],
    candidateCanonical: canonical,
    deployed: resolution.deployed,
  });
  writeWork("gates.json", { ...report, ui_version: uiVersion, snapshot_canonical_sha256: canonical });
  for (const [name, result] of Object.entries(report.results)) console.log(`${result.status.padEnd(7)} ${name}: ${result.detail}`);
  if (!report.ok) process.exit(1);
}

async function recheck(): Promise<void> {
  const resolution = readJson<Resolution>(path.join(WORK, "resolve.json"));
  const current = await currentDeployed();
  const errors = recheckErrors(resolution.deployed?.receipt_sha ?? null, current?.sha ?? null);
  if (errors.length > 0) failWith(errors);
  console.log("deploy: the deployed generation is unchanged since resolve");
}

async function runProbe(): Promise<void> {
  const baseUrl = process.env.PROBE_BASE_URL ?? "";
  if (!baseUrl) failWith(["PROBE_BASE_URL is required"]);
  const outcome = await probe(baseUrl, checksumManifest(SITE_DIR), {
    attempts: Number(process.env.PROBE_ATTEMPTS ?? 6),
    delayMs: Number(process.env.PROBE_DELAY_MS ?? 10_000),
  });
  writeWork("probe.json", outcome);
  console.log(`probe ${outcome.ok ? "ok" : "FAILED"}: ${outcome.matched} matched, ${outcome.mismatched.length} mismatched, ${outcome.errors.length} errors, deep link ${outcome.deep_link.status}`);
  output("probes_ok", String(outcome.ok));
}

async function receipt(): Promise<void> {
  const resolution = readJson<Resolution>(path.join(WORK, "resolve.json"));
  const gateReport = readJson<{ ok: boolean; results: Record<string, { status: string }>; ui_version: number; snapshot_canonical_sha256?: string | null }>(
    path.join(WORK, "gates.json"),
  );
  const probes = existsSync(path.join(WORK, "probe.json"))
    ? readJson<{ ok: boolean; matched: number; mismatched: string[]; errors: string[]; attempts: number }>(path.join(WORK, "probe.json"))
    : { ok: false, matched: 0, mismatched: [], errors: ["not probed"], attempts: 0 };
  const coreCommit = await githubApi()(`repos/${CORE_REPO}/commits/${resolution.core_sha}`);
  const coreMergedAt = coreCommit.status === 200 ? ((coreCommit.body as { commit?: { committer?: { date?: string } } }).commit?.committer?.date ?? null) : null;
  const liveAt = new Date().toISOString();
  const run = await githubApi()(`repos/${SITE_REPO}/actions/runs/${process.env.GITHUB_RUN_ID ?? "0"}`);
  const queuedAt = process.env.QUEUED_AT ?? (run.status === 200 ? (run.body as { created_at?: string }).created_at : undefined) ?? liveAt;
  const digest = treeDigest(SITE_DIR);
  const value: Receipt = {
    schema: RECEIPT_SCHEMA,
    mode: resolution.mode,
    target: process.env.SITE_DEPLOY_TARGET || "none",
    site_sha: process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    run_id: process.env.GITHUB_RUN_ID ?? "0",
    deployment_id: process.env.DEPLOYMENT_ID ? Number(process.env.DEPLOYMENT_ID) : null,
    core_sha: resolution.core_sha,
    corpus_sha: resolution.corpus_sha,
    bundle_digest: resolution.bundle_digest,
    snapshot_sha256: snapshotSha(SITE_DIR),
    snapshot_canonical_sha256: gateReport.snapshot_canonical_sha256 ?? null,
    artifact: { sha256: digest.sha256, total_bytes: digest.totalBytes, total_files: digest.totalFiles },
    explorer_read_model_version: gateReport.ui_version,
    snapshot_read_model_version: resolution.snapshot_read_model_version,
    gates: { ok: gateReport.ok, results: Object.fromEntries(Object.entries(gateReport.results).map(([name, result]) => [name, result.status])) },
    probes: { ok: probes.ok, matched: probes.matched, mismatched: probes.mismatched, errors: probes.errors, attempts: probes.attempts },
    rollback_of: resolution.rollback_target?.run_id ?? null,
    queued_at: queuedAt,
    core_merged_at: coreMergedAt,
    live_at: liveAt,
    core_merge_to_live_seconds: latencySeconds(coreMergedAt, liveAt),
  };
  mkdirSync(WORK, { recursive: true });
  writeFileSync(path.join(WORK, "receipt.json"), receiptBytes(value));
  output("receipt_sha", receiptSha(value));
  output("status_description", statusDescription(value));
}

function rollbackDecision(): void {
  const resolution = readJson<Resolution>(path.join(WORK, "resolve.json"));
  const probes = readJson<{ ok: boolean }>(path.join(WORK, "probe.json"));
  const deployedFile = path.join(WORK, "deployed-receipt.json");
  const lastKnownGood = resolution.deployed && existsSync(deployedFile) ? readJson<Receipt>(deployedFile) : null;
  const decision = automaticRollback({ mode: resolution.mode, probesOk: probes.ok, lastKnownGood, currentRunId: process.env.GITHUB_RUN_ID ?? "0" });
  console.log(`rollback: ${decision.reason}`);
  output("dispatch", String(decision.dispatch));
  if (decision.dispatch) output("target_run_id", decision.targetRunId);
}

async function deploymentId(): Promise<void> {
  const api = githubApi();
  const runId = process.env.GITHUB_RUN_ID ?? "";
  const listed = await api(`repos/${SITE_REPO}/deployments?environment=github-pages&per_page=20`);
  if (listed.status !== 200) failWith([`listing deployments failed (HTTP ${listed.status})`]);
  const bound = new RegExp(`/actions/runs/${runId}(?:[/?#]|$)`);
  for (const deployment of listed.body as { id: number }[]) {
    const statuses = await api(`repos/${SITE_REPO}/deployments/${deployment.id}/statuses?per_page=20`);
    const urls = (statuses.body as { log_url?: string; target_url?: string }[]).flatMap((status) => [status.log_url ?? "", status.target_url ?? ""]);
    if (urls.some((url) => bound.test(url))) {
      output("deployment_id", String(deployment.id));
      return;
    }
  }
  failWith([`no github-pages deployment is bound to run ${runId}`]);
}

async function recordStatus(): Promise<void> {
  const value = readJson<Receipt>(path.join(WORK, "receipt.json"));
  if (!(value.gates.ok && value.probes.ok)) {
    console.log("record: the receipt is not last known good, so it is not recorded as the deployed generation");
    return;
  }
  if (value.deployment_id === null) failWith(["record: the receipt has no deployment id"]);
  const runUrl = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${SITE_REPO}/actions/runs/${value.run_id}`;
  const posted = await githubApi()(`repos/${SITE_REPO}/deployments/${value.deployment_id}/statuses`, {
    method: "POST",
    body: { state: "success", description: statusDescription(value), log_url: runUrl, environment_url: process.env.SITE_ORIGIN, auto_inactive: false },
  });
  if (posted.status !== 201) failWith([`recording the receipt failed (HTTP ${posted.status})`]);
  console.log(`record: ${statusDescription(value)}`);
}

async function deployedRun(): Promise<void> {
  const current = await currentDeployed();
  if (!current) {
    console.log("deployed: no receipt is recorded on any deployment");
    output("run_id", "");
    return;
  }
  output("run_id", current.receipt.run_id);
  output("core_sha", current.receipt.core_sha);
  output("bundle_digest", current.receipt.bundle_digest);
  output("site_sha", current.receipt.site_sha);
}

const commands: Record<string, () => void | Promise<void>> = {
  deployed: deployedRun,
  "deployment-id": deploymentId,
  record: recordStatus,
  resolve,
  gates,
  recheck,
  rehearsal: () => console.log(`rehearsal: marked ${markRehearsal(SITE_DIR)} pages noindex and replaced robots.txt`),
  probe: runProbe,
  receipt,
  "rollback-decision": rollbackDecision,
};

const command = process.argv[2] ?? "";
if (!commands[command]) failWith([`unknown command ${command}; expected one of ${Object.keys(commands).join(", ")}`]);
await commands[command]();
