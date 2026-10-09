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

export async function newestBundle(env = process.env) {
  if (env.SITE_INPUTS_RUN_ID) {
    const { artifacts } = await githubJson(`repos/${CORE_REPO}/actions/runs/${env.SITE_INPUTS_RUN_ID}/artifacts`, env);
    const artifact = artifacts.find((item) => item.name.startsWith(ARTIFACT_PREFIX) && !item.expired);
    if (!artifact) throw new Error(`run ${env.SITE_INPUTS_RUN_ID} has no unexpired site-inputs artifact`);
    return { runId: env.SITE_INPUTS_RUN_ID, artifact };
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
    execFileSync("gh", ["run", "download", runId, "-R", CORE_REPO, "-n", artifact.name, "-D", work], { stdio: "inherit" });
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
