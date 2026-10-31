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
import { downloadArtifact } from "./github-download.mjs";

const ARTIFACT_PREFIX = "site-inputs-";
export const MAX_PRODUCING_RUN_WAIT_MS = 10 * 60 * 1000;
export const PRODUCING_RUN_POLL_INTERVALS_MS = [5000, 10000, 15000, 30000];
export const RECENT_RUNS = 10;

const coreShaOf = (artifact) => artifact.name.slice(ARTIFACT_PREFIX.length);

async function compareStatus(base, head, env) {
  const result = await githubJson(`repos/${CORE_REPO}/compare/${base}...${head}?per_page=1`, env);
  return result.status;
}

export async function newestByCommitOrder(candidates, compare) {
  let best = candidates[0];
  for (const candidate of candidates.slice(1)) {
    const status = await compare(best.coreSha, candidate.coreSha);
    if (status === "ahead") best = candidate;
    else if (status === "diverged") {
      throw new Error(`diverged-bundle: bundles for core ${best.coreSha} and ${candidate.coreSha} have diverged; refusing to choose between them`);
    } else if (status !== "behind" && status !== "identical") {
      throw new Error(`comparing core ${best.coreSha} with ${candidate.coreSha} returned status ${status ?? "unknown"}`);
    }
  }
  return best;
}

async function recentBundles(env) {
  const { workflow_runs: runs } = await githubJson(
    `repos/${CORE_REPO}/actions/workflows/site-inputs.yml/runs?branch=develop&status=success&per_page=${RECENT_RUNS}`,
    env,
  );
  const bundles = [];
  for (const run of runs) {
    const { artifacts } = await githubJson(`repos/${CORE_REPO}/actions/runs/${run.id}/artifacts`, env);
    const artifact = artifacts.find((item) => item.name.startsWith(ARTIFACT_PREFIX) && !item.expired);
    if (!artifact) continue;
    const coreSha = coreShaOf(artifact);
    if (bundles.some((bundle) => bundle.coreSha === coreSha)) continue;
    bundles.push({ runId: String(run.id), artifact, coreSha });
  }
  return bundles;
}

function producingRunProvenanceErrors(run) {
  const errors = [];
  if (!run) return ["producing site-inputs run not found"];
  if (String(run.repository?.full_name ?? "").toLowerCase() !== CORE_REPO.toLowerCase())
    errors.push(`producing run is in ${run.repository?.full_name}, not ${CORE_REPO}`);
  if (run.path !== ".github/workflows/site-inputs.yml")
    errors.push(`producing run is ${run.path}, not site-inputs.yml`);
  if (run.head_branch !== "develop") errors.push(`producing run branch is ${run.head_branch}, not develop`);
  if (run.event !== "workflow_run" && run.event !== "workflow_dispatch")
    errors.push(`producing run event is ${run.event}, not workflow_run or workflow_dispatch`);
  return errors;
}

export function producingRunErrors(run) {
  const errors = producingRunProvenanceErrors(run);
  if (run && run.conclusion !== "success") errors.push(`producing run concluded ${run.conclusion}`);
  return errors;
}

export async function producingRun(runId, env = process.env, options = {}) {
  const maxWaitMs = options.maxWaitMs ?? MAX_PRODUCING_RUN_WAIT_MS;
  const now = options.now ?? (() => performance.now());
  const deadline = now() + maxWaitMs;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = options.log ?? console.log;
  const timeout = () => new Error(`producing run ${runId} did not complete within the ${maxWaitMs / 1000}s wait cap`);
  let attempt = 0;
  while (true) {
    const remaining = deadline - now();
    if (remaining <= 0) throw timeout();
    const signal = AbortSignal.timeout(Math.ceil(remaining));
    let run;
    try {
      run = await (options.fetchJson ?? githubJson)(`repos/${CORE_REPO}/actions/runs/${runId}`, env, signal);
    } catch (error) {
      if (signal.aborted || now() >= deadline) throw timeout();
      throw error;
    }
    if (now() >= deadline) throw timeout();
    const errors = producingRunProvenanceErrors(run);
    if (errors.length) throw new Error(errors.join("; "));
    if (run.conclusion && run.conclusion !== "success") throw new Error(`producing run concluded ${run.conclusion}`);
    if (run.status === "completed") {
      if (run.conclusion !== "success") throw new Error(`producing run concluded ${run.conclusion}`);
      return run;
    }
    const interval = PRODUCING_RUN_POLL_INTERVALS_MS[Math.min(attempt, PRODUCING_RUN_POLL_INTERVALS_MS.length - 1)];
    const delay = Math.min(interval, deadline - now());
    if (delay <= 0) throw timeout();
    log(`bundle:fetch: producing run ${runId} is ${run.status}; waiting ${delay / 1000}s...`);
    await sleep(delay);
    attempt += 1;
  }
}

export async function newestBundle(env = process.env, options = {}) {
  if (env.SITE_INPUTS_RUN_ID) {
    const { artifacts } = await githubJson(`repos/${CORE_REPO}/actions/runs/${env.SITE_INPUTS_RUN_ID}/artifacts`, env);
    const artifact = artifacts.find((item) => item.name.startsWith(ARTIFACT_PREFIX) && !item.expired);
    if (!artifact) throw new Error(`run ${env.SITE_INPUTS_RUN_ID} has no unexpired site-inputs artifact`);
    await producingRun(env.SITE_INPUTS_RUN_ID, env, options);
    const dispatchedSha = coreShaOf(artifact);
    const compare = options.compare ?? ((base, head) => compareStatus(base, head, env));
    const descendants = [];
    for (const bundle of await recentBundles(env)) {
      if (bundle.coreSha !== dispatchedSha && (await compare(dispatchedSha, bundle.coreSha)) === "ahead") descendants.push(bundle);
    }
    if (descendants.length === 0) return { runId: env.SITE_INPUTS_RUN_ID, artifact };
    const newest = await newestByCommitOrder(descendants, compare);
    console.log(
      `::notice::core bundle ${dispatchedSha} has a newer descendant bundle ${newest.coreSha}; deploying ${newest.coreSha} (run ${newest.runId}) instead`,
    );
    return { runId: newest.runId, artifact: newest.artifact, replaced: dispatchedSha };
  }
  if (env.SITE_INPUTS_CORE_SHA) {
    const name = `${ARTIFACT_PREFIX}${env.SITE_INPUTS_CORE_SHA}`;
    const { artifacts } = await githubJson(`repos/${CORE_REPO}/actions/artifacts?name=${name}&per_page=10`, env);
    const artifact = artifacts.find((item) => !item.expired && item.workflow_run?.head_branch === "develop");
    if (!artifact) throw new Error(`no unexpired develop bundle is named ${name}`);
    await producingRun(artifact.workflow_run.id, env, options);
    return { runId: String(artifact.workflow_run.id), artifact };
  }
  const bundles = await recentBundles(env);
  if (bundles.length === 0) throw new Error("no successful site-inputs run on develop has an unexpired bundle");
  const compare = options.compare ?? ((base, head) => compareStatus(base, head, env));
  const newest = await newestByCommitOrder(bundles, compare);
  return { runId: newest.runId, artifact: newest.artifact };
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
  const { runId, artifact, replaced } = await newestBundle();
  const work = mkdtempSync(path.join(tmpdir(), "site-inputs-fetch-"));
  try {
    downloadArtifact(CORE_REPO, runId, artifact.name, work);
    const archive = path.join(work, readdirSync(work).find((name) => name.endsWith(".tar.zst")) ?? "");
    const digest = `sha256:${createHash("sha256").update(readFileSync(archive)).digest("hex")}`;
    if (!replaced && process.env.SITE_INPUTS_DIGEST && process.env.SITE_INPUTS_DIGEST !== digest) {
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
