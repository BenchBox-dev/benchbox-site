import { memoizedSnapshotQueryRows } from "@/lib/duckdbQueries";
import { CORPUS_LABEL_COLUMNS, parseCorpusLabels, type CorpusLabels } from "@/lib/corpusLabels";

export async function corpusLabelColumnsPresent(): Promise<boolean> {
  const names = CORPUS_LABEL_COLUMNS.map((name) => `'${name}'`).join(", ");
  const rows = await memoizedSnapshotQueryRows<{ column_name: string }>("corpus-label-columns", {
    sql:
      "SELECT column_name FROM duckdb_columns()" +
      ` WHERE database_name = 'bench' AND table_name = 'results' AND column_name IN (${names})`,
  });
  if (rows.length === 0) return false;
  if (rows.length !== CORPUS_LABEL_COLUMNS.length) {
    const present = new Set(rows.map((row) => row.column_name));
    const missing = CORPUS_LABEL_COLUMNS.filter((name) => !present.has(name));
    throw new Error(`results carries only part of the corpus label columns; missing ${missing.join(", ")}`);
  }
  return true;
}

export async function loadCorpusLabels(): Promise<ReadonlyMap<string, CorpusLabels>> {
  const labels = new Map<string, CorpusLabels>();
  if (!(await corpusLabelColumnsPresent())) return labels;
  const rows = await memoizedSnapshotQueryRows<Record<string, unknown>>("corpus-labels", {
    sql: `SELECT result_id, ${CORPUS_LABEL_COLUMNS.join(", ")} FROM bench.results`,
  });
  for (const row of rows) labels.set(String(row.result_id), parseCorpusLabels(row));
  return labels;
}
