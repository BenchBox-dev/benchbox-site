#!/usr/bin/env node
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { readExplorerBuildContract } from "./explorer-build-contract.mjs";
import { explorerRoot, fileSha, siteInputsPath } from "./site-inputs.mjs";

const snapshotPath = join(explorerRoot, "public", "data", "results.duckdb");
const resultBundlesPath = join(explorerRoot, "public", "data", "bundles");

function log(message) {
  console.log(`[explorer-dev-snapshot] ${message}`);
}

if (process.env.EXPLORER_SKIP_PREDEV === "1") {
  log("skipped by EXPLORER_SKIP_PREDEV=1");
} else {
  readExplorerBuildContract();
  const source = siteInputsPath("explorer", "results.duckdb");
  if (existsSync(snapshotPath) && fileSha(snapshotPath) === fileSha(source)) {
    log("snapshot matches the core bundle");
  } else {
    mkdirSync(dirname(snapshotPath), { recursive: true });
    copyFileSync(source, snapshotPath);
    log(`copied the core bundle snapshot to ${snapshotPath}`);
  }
  const resultBundles = siteInputsPath("explorer", "bundles");
  rmSync(resultBundlesPath, { recursive: true, force: true });
  if (existsSync(resultBundles)) {
    cpSync(resultBundles, resultBundlesPath, { recursive: true });
    log(`copied the core bundle's per-result files to ${resultBundlesPath}`);
  }
}
