import type { DocsData } from "./docs-data.ts";
import { renderCompatPages } from "./compat-pages.ts";
import { renderQueryPages } from "./query-pages.ts";
import { renderTuningPage } from "./tuning-matrix.ts";

export const GENERATED_DIRECTORIES = ["benchmarks/queries", "compat"];
export const GENERATED_FILES = ["reference/tuning-platform-support.md"];

export function inGeneratedScope(relative: string): boolean {
  return GENERATED_FILES.includes(relative) || GENERATED_DIRECTORIES.some((directory) => relative.startsWith(`${directory}/`));
}

export function generateDocsPages(data: DocsData): Map<string, string> {
  const files = renderQueryPages(data);
  for (const [relative, content] of renderCompatPages(data)) files.set(relative, content);
  const tuning = renderTuningPage(data);
  files.set(tuning.path, tuning.content);
  return files;
}
