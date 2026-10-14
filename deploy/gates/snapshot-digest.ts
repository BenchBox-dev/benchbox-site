import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fail, pass, skipped, type GateResult } from "./types.ts";

export const SNAPSHOT_PATH = "results/data/results.duckdb";

export function snapshotSha(siteDir: string): string {
  return createHash("sha256").update(readFileSync(path.join(siteDir, SNAPSHOT_PATH))).digest("hex");
}

export type SnapshotApproval = { change: string; reason: string };

export function snapshotChange(deployedCanonical: string, candidateCanonical: string): string {
  return `${deployedCanonical}->${candidateCanonical}`;
}

export function snapshotDigestGate(input: {
  siteDir: string;
  corpusSha: string;
  candidateCanonical: string | null;
  deployed: { corpus_sha: string; snapshot_sha256: string; snapshot_canonical_sha256?: string | null } | null;
  approval?: SnapshotApproval | null;
}): GateResult {
  if (!existsSync(path.join(input.siteDir, SNAPSHOT_PATH))) return fail(`${SNAPSHOT_PATH} is missing from the artifact`);
  if (!input.deployed) return skipped("no deployed generation to compare against");
  if (input.deployed.corpus_sha !== input.corpusSha) return skipped("the corpus changed, so the snapshot is expected to change");
  if (snapshotSha(input.siteDir) === input.deployed.snapshot_sha256) return pass("corpus is unchanged and the snapshot is byte-identical to the deployed one");
  const deployedCanonical = input.deployed.snapshot_canonical_sha256;
  if (!deployedCanonical) {
    return skipped("the snapshot file changed and the deployed receipt predates canonical digests, so its contents cannot be compared");
  }
  if (!input.candidateCanonical) return fail("the candidate snapshot has no canonical digest");
  if (input.candidateCanonical !== deployedCanonical) {
    const change = snapshotChange(deployedCanonical, input.candidateCanonical);
    if (input.approval?.change === change) {
      if (!input.approval.reason) return fail(`SITE_SNAPSHOT_APPROVED_CHANGE matches ${change} but SITE_SNAPSHOT_APPROVAL_REASON is empty`);
      return pass(`corpus is unchanged and the approved snapshot change ${change} matches: ${input.approval.reason}`);
    }
    return fail(
      `corpus is unchanged but the snapshot contents changed: canonical digest ${deployedCanonical} became ${input.candidateCanonical}; after review, set SITE_SNAPSHOT_APPROVED_CHANGE to ${change} and SITE_SNAPSHOT_APPROVAL_REASON to the reason`,
    );
  }
  return pass(`corpus is unchanged and the snapshot contents match the deployed ones (canonical digest ${input.candidateCanonical})`);
}
