import type { BoundaryContext, Violation } from "../lib/types.ts";

const NEGATIVE_ROOTS = ["agent", "internal", "_project"];
const NEGATIVE_PREFIXES = ["design/future-state/"];
const NEGATIVE_FILES = ["reference/threat-model.md", "platforms/workaround-index.md", "tpc-licensing-analysis.md"];

export function negativeOwnership(path: string): string | null {
  const root = path.split("/")[0];
  if (path.includes("/") && NEGATIVE_ROOTS.includes(root)) return `${root} is maintainer-only content`;
  const prefix = NEGATIVE_PREFIXES.find((candidate) => path.startsWith(candidate));
  if (prefix !== undefined) return `${prefix} is unpublished planning content`;
  if (NEGATIVE_FILES.includes(path)) return "core keeps this page";
  return null;
}

export function boundaryViolations({ pages, contracts }: BoundaryContext): Violation[] {
  const found: Violation[] = [];
  const published = new Set(pages.map((entry) => entry.path));
  for (const path of published) {
    const reason = negativeOwnership(path);
    if (reason !== null) found.push({ check: "publication-boundary", page: path, invariant: `published although ${reason}` });
  }
  if (contracts === null) return found;
  const { publication } = contracts;
  for (const path of publication.exclusions.filter((entry) => !entry.endsWith("/"))) {
    if (published.has(path)) found.push({ check: "publication-boundary", page: path, invariant: "published although the exported exclusions list it" });
  }
  for (const root of publication.excluded_roots) {
    for (const path of published) {
      if (path.startsWith(`${root}/`)) found.push({ check: "publication-boundary", page: path, invariant: `published although exported excluded root ${root} covers it` });
    }
  }
  const allowed = new Set(publication.allowlist);
  for (const path of published) {
    const gated = publication.gated_roots.some((root) => path.startsWith(`${root}/`));
    if (gated && !allowed.has(path)) found.push({ check: "publication-boundary", page: path, invariant: "published from a gated directory without an allowlist entry" });
  }
  for (const path of publication.allowlist) {
    if (!published.has(path)) found.push({ check: "publication-boundary", page: path, invariant: "allowlisted but not published" });
  }
  return found;
}
