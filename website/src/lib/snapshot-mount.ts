import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { siteInputsPath } from "./site-inputs.ts";

export const MOUNTED_SNAPSHOT = path.join("results", "data", "results.duckdb");

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function assertMountedSnapshotMatchesBundle(out: string): void {
  const mounted = sha256(path.join(out, MOUNTED_SNAPSHOT));
  const summarized = sha256(siteInputsPath("explorer", "results.duckdb"));
  if (mounted !== summarized) {
    throw new Error(`The Results Explorer serves snapshot ${mounted} but the result summary pages were generated from ${summarized}`);
  }
}
