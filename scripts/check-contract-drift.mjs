#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { EXPECTED_READ_MODEL_VERSION } from "../explorer/scripts/explorer-build-contract.mjs";
import { newestBundle } from "./bundle-fetch.mjs";
import { CORE_REPO, certificationErrors, githubJson } from "./bundle-verify.mjs";

const CONTRACT_MEMBER = "site-inputs-bundle/explorer/contract.json";
const MANIFEST_MEMBER = "site-inputs-bundle/manifest.json";

export function driftErrors(expected, contract) {
  const version = contract?.read_model_version;
  if (version === expected) return [];
  if (typeof version !== "number") {
    return [`Explorer read-model drift: newest certified bundle has no numeric read_model_version, site expects ${expected}.`];
  }
  return [
    `Explorer read-model drift: site expects ${expected}, newest certified bundle has ${version}. ` +
      `Update the Explorer for the new contract before taking this bundle.`,
  ];
}

export function extractMember(tarball, member) {
  return execFileSync("tar", ["-xf", tarball, "-O", member], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
}

async function main() {
  const { runId, artifact } = await newestBundle();
  const work = mkdtempSync(path.join(tmpdir(), "contract-drift-"));
  try {
    execFileSync("gh", ["run", "download", runId, "-R", CORE_REPO, "-n", artifact.name, "-D", work], { stdio: "inherit" });
    const archive = path.join(work, readdirSync(work).find((name) => name.endsWith(".tar.zst")) ?? "");
    const tarball = path.join(work, "bundle.tar");
    writeFileSync(tarball, zstdDecompressSync(readFileSync(archive)));
    const manifest = JSON.parse(extractMember(tarball, MANIFEST_MEMBER));
    const certifiedBy = String(manifest.certified_by ?? "");
    if (!/^\d+$/.test(certifiedBy)) throw new Error(`certified_by ${manifest.certified_by} is not a run id`);
    let run;
    try {
      run = await githubJson(`repos/${CORE_REPO}/actions/runs/${certifiedBy}`);
    } catch (error) {
      throw new Error(`certification check failed closed: ${error.message}`);
    }
    const certErrors = certificationErrors(run, manifest);
    if (certErrors.length > 0) throw new Error(`newest bundle is not certified:\n  ${certErrors.join("\n  ")}`);
    const contract = JSON.parse(extractMember(tarball, CONTRACT_MEMBER)).build_contract;
    const errors = driftErrors(EXPECTED_READ_MODEL_VERSION, contract);
    if (errors.length > 0) throw new Error(errors.join("\n"));
    console.log(
      `contract drift: none (site ${EXPECTED_READ_MODEL_VERSION}, bundle ${contract.read_model_version} from run ${runId})`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`contract-drift: ${error.message}`);
    process.exit(1);
  });
}
