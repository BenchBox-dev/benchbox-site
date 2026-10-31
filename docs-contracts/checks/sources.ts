import { stripFences } from "../lib/markdown.ts";
import type { Context, Violation } from "../lib/types.ts";

const MAINTAINER_ROOTS = ["development/", "design/", "blog/"];
const SOURCE_PATH = /`docs\/[^`\s]*\.md[^`\s]*`/g;
const PULL_REQUEST = /\bPR #\d+/g;

export function sourceReferenceViolations(ctx: Context): Violation[] {
  const found: Violation[] = [];
  for (const entry of ctx.pages) {
    if (MAINTAINER_ROOTS.some((root) => entry.path.startsWith(root))) continue;
    const prose = stripFences(entry.text);
    for (const match of new Set(prose.match(SOURCE_PATH) ?? [])) {
      found.push({ check: "user-page-sources", page: entry.path, invariant: `names the source file ${match}; link the published page instead` });
    }
    for (const match of new Set(prose.match(PULL_REQUEST) ?? [])) {
      found.push({ check: "user-page-sources", page: entry.path, invariant: `cites ${match}; state the user-facing behaviour instead` });
    }
  }
  return found;
}
