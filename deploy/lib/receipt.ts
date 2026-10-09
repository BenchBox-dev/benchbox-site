import { createHash } from "node:crypto";

export const RECEIPT_SCHEMA = "site-deploy-receipt/v1";
export const RECEIPT_STATUS = /^site-deploy receipt sha256:([0-9a-f]{64}) run:(\d+)$/;

export type GateSummary = { ok: boolean; results: Record<string, string> };
export type ProbeSummary = { ok: boolean; matched: number; mismatched: string[]; errors: string[]; attempts: number };

export type Receipt = {
  schema: typeof RECEIPT_SCHEMA;
  mode: "deploy" | "redeploy" | "rollback";
  target: string;
  site_sha: string;
  run_id: string;
  deployment_id: number | null;
  core_sha: string;
  corpus_sha: string;
  bundle_digest: string;
  snapshot_sha256: string;
  artifact: { sha256: string; total_bytes: number; total_files: number };
  explorer_read_model_version: number;
  snapshot_read_model_version: number;
  gates: GateSummary;
  probes: ProbeSummary;
  rollback_of: string | null;
  queued_at: string;
  core_merged_at: string | null;
  live_at: string;
  core_merge_to_live_seconds: number | null;
};

const REQUIRED: (keyof Receipt)[] = [
  "schema",
  "mode",
  "target",
  "site_sha",
  "run_id",
  "core_sha",
  "corpus_sha",
  "bundle_digest",
  "snapshot_sha256",
  "artifact",
  "explorer_read_model_version",
  "snapshot_read_model_version",
  "gates",
  "probes",
  "queued_at",
  "live_at",
];

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as object).sort().map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]));
  }
  return value;
}

export function receiptBytes(receipt: Receipt): string {
  return `${JSON.stringify(sortKeys(receipt), null, 2)}\n`;
}

export function receiptSha(receipt: Receipt): string {
  return createHash("sha256").update(receiptBytes(receipt)).digest("hex");
}

export function statusDescription(receipt: Receipt): string {
  return `site-deploy receipt sha256:${receiptSha(receipt)} run:${receipt.run_id}`;
}

export function parseStatusDescription(description: string | null | undefined): { sha: string; runId: string } | null {
  const match = RECEIPT_STATUS.exec(description ?? "");
  return match ? { sha: match[1], runId: match[2] } : null;
}

export function receiptErrors(receipt: Partial<Receipt>): string[] {
  const errors: string[] = [];
  for (const key of REQUIRED) if (receipt[key] === undefined || receipt[key] === null) errors.push(`receipt is missing ${key}`);
  if (receipt.schema !== undefined && receipt.schema !== RECEIPT_SCHEMA) errors.push(`receipt schema ${receipt.schema} is not ${RECEIPT_SCHEMA}`);
  for (const key of ["core_sha", "corpus_sha", "site_sha"] as const) {
    if (receipt[key] && !/^[0-9a-f]{40}$/.test(receipt[key] as string)) errors.push(`receipt ${key} is not a full commit SHA`);
  }
  if (receipt.artifact && !/^[0-9a-f]{64}$/.test(receipt.artifact.sha256)) errors.push("receipt artifact sha256 is not 64 hex characters");
  if (receipt.snapshot_sha256 && !/^[0-9a-f]{64}$/.test(receipt.snapshot_sha256)) errors.push("receipt snapshot_sha256 is not 64 hex characters");
  if (receipt.probes && typeof receipt.probes.ok !== "boolean") errors.push("receipt probes.ok is missing");
  if (receipt.gates && typeof receipt.gates.ok !== "boolean") errors.push("receipt gates.ok is missing");
  return errors;
}

export function isLastKnownGood(receipt: Receipt | null | undefined): boolean {
  if (!receipt || receiptErrors(receipt).length > 0) return false;
  return receipt.gates.ok === true && receipt.probes.ok === true && receipt.target !== "none";
}

export function latencySeconds(coreMergedAt: string | null, liveAt: string): number | null {
  if (!coreMergedAt) return null;
  return Math.max(0, Math.round((Date.parse(liveAt) - Date.parse(coreMergedAt)) / 1000));
}
