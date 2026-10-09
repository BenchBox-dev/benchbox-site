export const EDIT_BASE = "https://github.com/BenchBox-dev/BenchBox/edit/develop/";
export const SITE_EDIT_BASE = "https://github.com/BenchBox-dev/benchbox-site/edit/main/";

const GENERATED_PREFIXES = ["docs/_tags/", "docs/benchmarks/queries/"];

export function editUrlFor(sourcePath: string | undefined): string | undefined {
  if (!sourcePath || sourcePath.startsWith("/") || sourcePath.includes("..")) return undefined;
  if (GENERATED_PREFIXES.some((prefix) => sourcePath.startsWith(prefix))) return undefined;
  if (sourcePath.startsWith("docs/blog/")) return `${SITE_EDIT_BASE}${sourcePath.slice("docs/".length)}`;
  return `${EDIT_BASE}${sourcePath}`;
}
