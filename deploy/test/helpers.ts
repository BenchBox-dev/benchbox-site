import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RECEIPT_SCHEMA, type Receipt } from "../lib/receipt.ts";

export function site(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(path.join(tmpdir(), "deploy-site-"));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), body);
  }
  return root;
}

export function receipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    schema: RECEIPT_SCHEMA,
    mode: "deploy",
    target: "rehearsal",
    site_sha: "1".repeat(40),
    run_id: "100",
    deployment_id: 7,
    core_sha: "a".repeat(40),
    corpus_sha: "c".repeat(40),
    bundle_digest: `sha256:${"d".repeat(64)}`,
    snapshot_sha256: "e".repeat(64),
    artifact: { sha256: "f".repeat(64), total_bytes: 10, total_files: 2 },
    explorer_read_model_version: 14,
    snapshot_read_model_version: 14,
    gates: { ok: true, results: { privacy: "pass" } },
    probes: { ok: true, matched: 3, mismatched: [], errors: [], attempts: 1 },
    rollback_of: null,
    queued_at: "2026-10-09T00:00:00Z",
    core_merged_at: "2026-10-08T23:50:00Z",
    live_at: "2026-10-09T00:05:00Z",
    core_merge_to_live_seconds: 900,
    ...overrides,
  };
}
