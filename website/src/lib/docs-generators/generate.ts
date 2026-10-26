import type { DocsData } from "./docs-data.ts";
import { renderCompatPages } from "./compat-pages.ts";
import { renderQueryPages } from "./query-pages.ts";
import { renderTuningPage } from "./tuning-matrix.ts";

export function generateDocsPages(data: DocsData): Map<string, string> {
  const files = renderQueryPages(data);
  for (const [relative, content] of renderCompatPages(data)) files.set(relative, content);
  const tuning = renderTuningPage(data);
  files.set(tuning.path, tuning.content);
  return files;
}
