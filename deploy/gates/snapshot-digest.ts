import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fail, pass, skipped, type GateResult } from "./types.ts";

export const SNAPSHOT_PATH = "results/data/results.duckdb";

export function snapshotSha(siteDir: string): string {
  return createHash("sha256").update(readFileSync(path.join(siteDir, SNAPSHOT_PATH))).digest("hex");
}

export function snapshotDigestGate(input: {
  siteDir: string;
  corpusSha: string;
  deployed: { corpus_sha: string; snapshot_sha256: string } | null;
}): GateResult {
  if (!existsSync(path.join(input.siteDir, SNAPSHOT_PATH))) return fail(`${SNAPSHOT_PATH} is missing from the artifact`);
  if (!input.deployed) return skipped("no deployed generation to compare against");
  if (input.deployed.corpus_sha !== input.corpusSha) return skipped("the corpus changed, so the snapshot is expected to change");
  const candidate = snapshotSha(input.siteDir);
  if (candidate !== input.deployed.snapshot_sha256) {
    return fail(`corpus is unchanged but the snapshot changed: ${input.deployed.snapshot_sha256} became ${candidate}`);
  }
  return pass("corpus is unchanged and the snapshot matches the deployed one");
}
