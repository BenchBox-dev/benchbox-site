import { inGeneratedScope } from "./docs-generators/generate.ts";

export const SITE_EDIT_BASE = "https://github.com/BenchBox-dev/benchbox-site/edit/main/";

const RENDERER_PREFIXES = ["docs/_tags/"];

export function editUrlFor(sourcePath: string | undefined): string | undefined {
  if (!sourcePath || sourcePath.startsWith("/") || sourcePath.includes("..")) return undefined;
  if (RENDERER_PREFIXES.some((prefix) => sourcePath.startsWith(prefix))) return undefined;
  if (sourcePath.startsWith("docs/") && inGeneratedScope(sourcePath.slice("docs/".length))) return undefined;
  if (sourcePath.startsWith("docs/blog/")) return `${SITE_EDIT_BASE}${sourcePath.slice("docs/".length)}`;
  return `${SITE_EDIT_BASE}${sourcePath}`;
}
