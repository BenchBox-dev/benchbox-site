import { readdirSync } from "node:fs";
import path from "node:path";

export const RENDERER_ROOTS: ReadonlySet<string> = new Set(["_build", "_tags", "_static", "_templates"]);

const CORE_ONLY_ROOTS: readonly string[] = ["agent", "internal", "_project"];
const CORE_ONLY_PREFIXES: readonly string[] = ["design/future-state/"];
const CORE_ONLY_FILES: ReadonlySet<string> = new Set([
  "reference/threat-model.md",
  "platforms/workaround-index.md",
  "tpc-licensing-analysis.md",
  "publish-allowlist.txt",
  "publish-exclusions.txt",
  "operations/local-platform-provisioning.tsv",
]);

export type DocSourceFile = { absolute: string; relative: string };

export function coreOnlyReason(relative: string): string | null {
  const root = relative.split("/")[0];
  if (relative.includes("/") && CORE_ONLY_ROOTS.includes(root)) return `${root}/ is maintainer-only content that core keeps`;
  const prefix = CORE_ONLY_PREFIXES.find((candidate) => relative.startsWith(candidate));
  if (prefix !== undefined) return `${prefix} is unpublished planning content that core keeps`;
  if (CORE_ONLY_FILES.has(relative)) return "core keeps this file";
  return null;
}

export class CoreOnlyContentError extends Error {
  readonly violations: readonly string[];

  constructor(violations: readonly string[]) {
    super(`the documentation tree holds core-only content that the site must not publish:\n${violations.map((entry) => `  ${entry}`).join("\n")}`);
    this.name = "CoreOnlyContentError";
    this.violations = violations;
  }
}

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function walk(root: string, directory: string, found: DocSourceFile[]): void {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => compareNames(a.name, b.name));
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (entry.name.startsWith(".#")) continue;
    if (entry.isDirectory()) {
      if (directory === root && RENDERER_ROOTS.has(entry.name)) continue;
      if (entry.name === "_sources" || entry.name.endsWith(".lproj")) continue;
      walk(root, absolute, found);
    } else {
      found.push({ absolute, relative });
    }
  }
}

export function walkDocFiles(docsRoot: string): DocSourceFile[] {
  const found: DocSourceFile[] = [];
  walk(docsRoot, docsRoot, found);
  return found;
}

export function assertNoCoreOnlyContent(files: readonly DocSourceFile[]): void {
  const violations = files.flatMap((file) => {
    const reason = coreOnlyReason(file.relative);
    return reason === null ? [] : [`${file.relative}: ${reason}`];
  });
  if (violations.length > 0) throw new CoreOnlyContentError(violations);
}

export function listDocSources(docsRoot: string, suffix: ".md" | ".rst" = ".md"): DocSourceFile[] {
  const files = walkDocFiles(docsRoot);
  assertNoCoreOnlyContent(files);
  return files.filter((file) => file.relative.endsWith(suffix));
}
