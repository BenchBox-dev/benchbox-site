import { explorerCompatGate } from "./explorer-compat.ts";
import { linksGate, type BrokenLink } from "./links.ts";
import { originGate } from "./origin.ts";
import { privacyGate } from "./privacy.ts";
import { snapshotDigestGate } from "./snapshot-digest.ts";
import { skipped, type GateResult } from "./types.ts";

export type GateInputs = {
  siteDir: string;
  mode: "deploy" | "redeploy" | "rollback";
  target: string;
  corpusSha: string;
  uiVersion: number;
  snapshotVersion: number;
  allowance: BrokenLink[];
  originAllowlist: RegExp[];
  extraHosts: string[];
  candidateCanonical: string | null;
  deployed: { corpus_sha: string; snapshot_sha256: string; snapshot_canonical_sha256?: string | null; ui: number; snapshot: number } | null;
};

export type GateReport = { ok: boolean; mode: string; results: Record<string, GateResult> };

const RESTORED = "a restored artifact was gated when it was first deployed";

export function runGates(inputs: GateInputs): GateReport {
  const run = (gate: () => GateResult): GateResult => {
    try {
      return gate();
    } catch (error) {
      return { status: "fail", detail: `gate raised ${(error as Error).name}: ${(error as Error).message}` };
    }
  };
  const deployedVersions = inputs.deployed ? { ui: inputs.deployed.ui, snapshot: inputs.deployed.snapshot } : null;
  const rollback = inputs.mode === "rollback";
  const results: Record<string, GateResult> = {
    privacy: run(() => privacyGate(inputs.siteDir)),
    explorer_compat: run(() =>
      explorerCompatGate({
        siteDir: inputs.siteDir,
        mode: inputs.mode,
        uiVersion: inputs.uiVersion,
        snapshotVersion: inputs.snapshotVersion,
        deployed: deployedVersions,
      }),
    ),
    snapshot_digest: rollback ? skipped(RESTORED) : run(() => snapshotDigestGate({ siteDir: inputs.siteDir, corpusSha: inputs.corpusSha, candidateCanonical: inputs.candidateCanonical, deployed: inputs.deployed })),
    links: rollback ? skipped(RESTORED) : run(() => linksGate({ siteDir: inputs.siteDir, allowance: inputs.allowance, extraHosts: inputs.extraHosts })),
    origin: run(() => originGate({ siteDir: inputs.siteDir, target: inputs.target, allowlist: inputs.originAllowlist })),
  };
  return { ok: Object.values(results).every((result) => result.status !== "fail"), mode: inputs.mode, results };
}
