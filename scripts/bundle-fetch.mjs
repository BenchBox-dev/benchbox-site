#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, renameSync, rmSync, mkdirSync, writeFileSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { siteInputsDir } from "./bundle-lib.mjs";
import { CORE_REPO, githubJson, verifyWithCertification } from "./bundle-verify.mjs";

const ARTIFACT_PREFIX = "site-inputs-";
export const MAX_PRODUCING_RUN_WAIT_MS = 10 * 60 * 1000;
export const PRODUCING_RUN_POLL_INTERVALS_MS = [5000, 10000, 15000, 30000];
export const DOWNLOAD_RETRY_INTERVALS_MS = [5000, 15000, 45000];
export const MAX_DOWNLOAD_ATTEMPTS = 3;
export const JOB_TIMEOUT_MS = 45 * 60 * 1000;

export function producingRunErrors(run) {
  const errors = [];
  if (!run) return ["producing site-inputs run not found"];
  if (String(run.repository?.full_name ?? "").toLowerCase() !== CORE_REPO.toLowerCase())
    errors.push(`producing run is in ${run.repository?.full_name}, not ${CORE_REPO}`);
  if (run.path !== ".github/workflows/site-inputs.yml")
    errors.push(`producing run is ${run.path}, not site-inputs.yml`);
  if (run.head_branch !== "develop") errors.push(`producing run branch is ${run.head_branch}, not develop`);
  if (run.event !== "workflow_run" && run.event !== "workflow_dispatch")
    errors.push(`producing run event is ${run.event}, not workflow_run or workflow_dispatch`);
  if (run.conclusion !== "success") errors.push(`producing run concluded ${run.conclusion}`);
  return errors;
}

export async function producingRun(runId, env = process.env, options = {}) {
  const maxWaitMs = options.maxWaitMs ?? MAX_PRODUCING_RUN_WAIT_MS;
  const pollIntervals = options.pollIntervals ?? PRODUCING_RUN_POLL_INTERVALS_MS;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = options.log ?? console.log;

  let elapsed = 0;
  let attempt = 0;

  while (true) {
    const run = await (options.fetchJson ?? githubJson)(`repos/${CORE_REPO}/actions/runs/${runId}`, env);
    if (!run) throw new Error("producing site-inputs run not found");

    if (String(run.repository?.full_name ?? "").toLowerCase() !== CORE_REPO.toLowerCase())
      throw new Error(`producing run is in ${run.repository?.full_name}, not ${CORE_REPO}`);
    if (run.path !== ".github/workflows/site-inputs.yml")
      throw new Error(`producing run is ${run.path}, not site-inputs.yml`);
    if (run.head_branch !== "develop")
      throw new Error(`producing run branch is ${run.head_branch}, not develop`);
    if (run.event !== "workflow_run" && run.event !== "workflow_dispatch")
      throw new Error(`producing run event is ${run.event}, not workflow_run or workflow_dispatch`);

    if (run.status === "completed" || run.conclusion) {
      if (run.conclusion !== "success") {
        throw new Error(`producing run concluded ${run.conclusion}`);
      }
      return run;
    }

    if (elapsed >= maxWaitMs) {
      throw new Error(`producing run ${runId} did not complete within the 10-minute wait cap (status: ${run.status})`);
    }

    const interval = pollIntervals[attempt] ?? pollIntervals[pollIntervals.length - 1];
    const delay = Math.min(interval, maxWaitMs - elapsed);
    if (delay <= 0) {
      throw new Error(`producing run ${runId} did not complete within the 10-minute wait cap (status: ${run.status})`);
    }

    log(`bundle:fetch: producing run ${runId} is ${run.status}; waiting ${delay / 1000}s...`);
    await sleep(delay);
    elapsed += delay;
    attempt += 1;
  }
}

export function isRetryableDownloadError(error) {
  if (!error) return false;
  const message = (error instanceof Error ? `${error.message} ${error.stderr ?? ""}` : String(error)).toLowerCase();
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

export function downloadArtifactWithRetry(runner, options = {}) {
  const maxAttempts = options.maxAttempts ?? MAX_DOWNLOAD_ATTEMPTS;
  const intervals = options.intervals ?? DOWNLOAD_RETRY_INTERVALS_MS;
  const sleep = options.sleep ?? ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms));
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
      log(`bundle:fetch: artifact download failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay / 1000}s: ${error.message}`);
      sleep(delay);
      attempt += 1;
    }
  }
}

export async function newestBundle(env = process.env, options = {}) {
  if (env.SITE_INPUTS_RUN_ID) {
    const { artifacts } = await githubJson(`repos/${CORE_REPO}/actions/runs/${env.SITE_INPUTS_RUN_ID}/artifacts`, env);
    const artifact = artifacts.find((item) => item.name.startsWith(ARTIFACT_PREFIX) && !item.expired);
    if (!artifact) throw new Error(`run ${env.SITE_INPUTS_RUN_ID} has no unexpired site-inputs artifact`);
    await producingRun(env.SITE_INPUTS_RUN_ID, env, options);
    return { runId: env.SITE_INPUTS_RUN_ID, artifact };
  }
  if (env.SITE_INPUTS_CORE_SHA) {
    const name = `${ARTIFACT_PREFIX}${env.SITE_INPUTS_CORE_SHA}`;
    const { artifacts } = await githubJson(`repos/${CORE_REPO}/actions/artifacts?name=${name}&per_page=10`, env);
    const artifact = artifacts.find((item) => !item.expired && item.workflow_run?.head_branch === "develop");
    if (!artifact) throw new Error(`no unexpired develop bundle is named ${name}`);
    await producingRun(artifact.workflow_run.id, env, options);
    return { runId: String(artifact.workflow_run.id), artifact };
  }
  const { workflow_runs: runs } = await githubJson(
    `repos/${CORE_REPO}/actions/workflows/site-inputs.yml/runs?branch=develop&status=success&per_page=10`,
    env,
  );
  for (const run of runs) {
    const { artifacts } = await githubJson(`repos/${CORE_REPO}/actions/runs/${run.id}/artifacts`, env);
    const artifact = artifacts.find((item) => item.name.startsWith(ARTIFACT_PREFIX) && !item.expired);
    if (artifact) return { runId: String(run.id), artifact };
  }
  throw new Error("no successful site-inputs run on develop has an unexpired bundle");
}

export function unpackArchive(archive, destination) {
  const tarball = path.join(path.dirname(archive), "bundle.tar");
  writeFileSync(tarball, zstdDecompressSync(readFileSync(archive)));
  const staging = mkdtempSync(path.join(tmpdir(), "site-inputs-unpack-"));
  execFileSync("tar", ["-xf", tarball, "-C", staging]);
  const root = path.join(staging, "site-inputs-bundle");
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(path.dirname(destination), { recursive: true });
  try {
    renameSync(root, destination);
  } catch {
    cpSync(root, destination, { recursive: true });
  }
  rmSync(staging, { recursive: true, force: true });
}

async function main() {
  const destination = siteInputsDir();
  const { runId, artifact } = await newestBundle();
  const work = mkdtempSync(path.join(tmpdir(), "site-inputs-fetch-"));
  try {
    downloadArtifactWithRetry(() => {
      execFileSync("gh", ["run", "download", runId, "-R", CORE_REPO, "-n", artifact.name, "-D", work], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    });
    const archive = path.join(work, readdirSync(work).find((name) => name.endsWith(".tar.zst")) ?? "");
    const digest = `sha256:${createHash("sha256").update(readFileSync(archive)).digest("hex")}`;
    if (process.env.SITE_INPUTS_DIGEST && process.env.SITE_INPUTS_DIGEST !== digest) {
      throw new Error(`bundle digest ${digest} does not match ${process.env.SITE_INPUTS_DIGEST}`);
    }
    unpackArchive(archive, destination);
    const result = await verifyWithCertification(destination);
    if (!result.ok) {
      rmSync(destination, { recursive: true, force: true });
      throw new Error(`bundle verification failed:\n  ${result.errors.join("\n  ")}`);
    }
    writeFileSync(path.join(destination, ".fetched.json"), `${JSON.stringify({ runId, artifact: artifact.name, digest }, null, 2)}\n`);
    console.log(`fetched ${artifact.name} from run ${runId} into ${destination} (${digest})`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`bundle:fetch: ${error.message}`);
    process.exit(1);
  });
}
