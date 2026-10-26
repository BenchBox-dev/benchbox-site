import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseDocsData } from "./docs-data.ts";
import { generateDocsPages } from "./generate.ts";

export const GENERATED_DIRECTORIES = ["benchmarks/queries", "compat"];
export const GENERATED_FILES = ["reference/tuning-platform-support.md"];

const EXCERPT_LIMIT = 120;
export const DEFAULT_LISTING_LIMIT = 50;

export type ParityDiff =
  | { kind: "missing"; path: string; generatedBytes: number; generatedSha256: string }
  | { kind: "extra"; path: string; bundledBytes: number; bundledSha256: string }
  | {
      kind: "changed";
      path: string;
      offset: number;
      line: number;
      column: number;
      generatedBytes: number;
      bundledBytes: number;
      generatedSha256: string;
      bundledSha256: string;
      generatedExcerpt: string;
      bundledExcerpt: string;
    };

export type ParityReport = {
  generated: number;
  bundled: number;
  identical: number;
  diffs: ParityDiff[];
};

export type Inventory = Record<string, { bytes: number; sha256: string }>;

export type ParityResult =
  | { status: "not-applicable"; message: string }
  | {
      status: "pass" | "fail";
      identity: { schema: number; coreSha: string; docsDataSha256: string };
      report: ParityReport;
      generatedInventory: Inventory;
      bundledInventory: Inventory;
    };

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function lineExcerpt(bytes: Buffer, offset: number): string {
  const start = bytes.lastIndexOf(0x0a, offset - 1) + 1;
  const newline = bytes.indexOf(0x0a, offset);
  const end = newline < 0 ? bytes.length : newline;
  const text = bytes.subarray(start, end).toString("utf-8");
  return JSON.stringify(text.length > EXCERPT_LIMIT ? `${text.slice(0, EXCERPT_LIMIT)}…` : text);
}

function firstDifference(generated: Buffer, bundled: Buffer): number {
  const shared = Math.min(generated.length, bundled.length);
  for (let at = 0; at < shared; at += 1) if (generated[at] !== bundled[at]) return at;
  return shared;
}

export function buildInventory(files: Map<string, Buffer>): Inventory {
  const inventory: Inventory = {};
  for (const relative of [...files.keys()].sort(compareText)) {
    const bytes = files.get(relative) as Buffer;
    inventory[relative] = { bytes: bytes.length, sha256: sha256(bytes) };
  }
  return inventory;
}

export function compareDocsPages(generated: Map<string, Buffer>, bundled: Map<string, Buffer>): ParityReport {
  const diffs: ParityDiff[] = [];
  let identical = 0;
  const paths = [...new Set([...generated.keys(), ...bundled.keys()])].sort(compareText);
  for (const relative of paths) {
    const left = generated.get(relative);
    const right = bundled.get(relative);
    if (left && !right) {
      diffs.push({ kind: "missing", path: relative, generatedBytes: left.length, generatedSha256: sha256(left) });
    } else if (right && !left) {
      diffs.push({ kind: "extra", path: relative, bundledBytes: right.length, bundledSha256: sha256(right) });
    } else if (left && right) {
      if (left.equals(right)) {
        identical += 1;
        continue;
      }
      const offset = firstDifference(left, right);
      const before = left.subarray(0, offset);
      const line = before.reduce((count, byte) => (byte === 0x0a ? count + 1 : count), 1);
      diffs.push({
        kind: "changed",
        path: relative,
        offset,
        line,
        column: offset - (before.lastIndexOf(0x0a) + 1) + 1,
        generatedBytes: left.length,
        bundledBytes: right.length,
        generatedSha256: sha256(left),
        bundledSha256: sha256(right),
        generatedExcerpt: lineExcerpt(left, offset),
        bundledExcerpt: lineExcerpt(right, offset),
      });
    }
  }
  return { generated: generated.size, bundled: bundled.size, identical, diffs };
}

function collectFiles(root: string, directory: string, into: Map<string, Buffer>): void {
  const absolute = path.join(root, directory);
  if (!existsSync(absolute)) return;
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) collectFiles(root, relative, into);
    else if (entry.isFile()) into.set(relative, readFileSync(path.join(root, relative)));
    else throw new Error(`bundled docs entry ${relative} is neither a regular file nor a directory`);
  }
}

export function readBundledScope(docsRoot: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const directory of GENERATED_DIRECTORIES) collectFiles(docsRoot, directory, files);
  for (const relative of GENERATED_FILES) {
    const absolute = path.join(docsRoot, relative);
    if (existsSync(absolute) && statSync(absolute).isFile()) files.set(relative, readFileSync(absolute));
  }
  return files;
}

export function formatParityReport(report: ParityReport, limit = DEFAULT_LISTING_LIMIT): string {
  const counts = { changed: 0, missing: 0, extra: 0 };
  for (const diff of report.diffs) counts[diff.kind] += 1;
  const lines = [
    `generated ${report.generated} files, bundled ${report.bundled} files in the generated scope, ${report.identical} byte-identical`,
    `changed ${counts.changed}, missing from bundle ${counts.missing}, not generated ${counts.extra}`,
  ];
  for (const diff of report.diffs.slice(0, limit)) {
    if (diff.kind === "changed") {
      lines.push(
        `CHANGED ${diff.path}: first difference at byte ${diff.offset} (line ${diff.line}, column ${diff.column}); generated ${diff.generatedBytes} bytes sha256 ${diff.generatedSha256}, bundled ${diff.bundledBytes} bytes sha256 ${diff.bundledSha256}`,
        `  generated: ${diff.generatedExcerpt}`,
        `  bundled:   ${diff.bundledExcerpt}`,
      );
    } else if (diff.kind === "missing") {
      lines.push(`MISSING ${diff.path}: generated (${diff.generatedBytes} bytes, sha256 ${diff.generatedSha256}) but absent from the bundled docs`);
    } else {
      lines.push(`EXTRA ${diff.path}: bundled (${diff.bundledBytes} bytes, sha256 ${diff.bundledSha256}) in the generated scope but not generated`);
    }
  }
  if (report.diffs.length > limit) lines.push(`… ${report.diffs.length - limit} more differences; the JSON report lists all`);
  return lines.join("\n");
}

export function runParity(bundleDir: string): ParityResult {
  const manifest = JSON.parse(readFileSync(path.join(bundleDir, "manifest.json"), "utf-8")) as { schema: number; core_sha: string };
  const docsDataFile = path.join(bundleDir, "docs-data", "docs-data.json");
  if (!existsSync(docsDataFile)) {
    return { status: "not-applicable", message: `bundle schema ${manifest.schema} carries no docs-data member, so there is nothing to compare` };
  }
  const docsRoot = path.join(bundleDir, "docs");
  if (!existsSync(docsRoot)) {
    throw new Error(`bundle schema ${manifest.schema} carries docs-data but no bundled docs to compare against`);
  }
  const docsDataText = readFileSync(docsDataFile, "utf-8");
  const generated = new Map<string, Buffer>();
  for (const [relative, content] of generateDocsPages(parseDocsData(docsDataText))) generated.set(relative, Buffer.from(content, "utf-8"));
  const bundled = readBundledScope(docsRoot);
  const report = compareDocsPages(generated, bundled);
  return {
    status: report.diffs.length === 0 ? "pass" : "fail",
    identity: { schema: manifest.schema, coreSha: manifest.core_sha, docsDataSha256: sha256(Buffer.from(docsDataText, "utf-8")) },
    report,
    generatedInventory: buildInventory(generated),
    bundledInventory: buildInventory(bundled),
  };
}
