import { memoizedSnapshotQueryRows } from "@/lib/duckdbQueries";
import { CORPUS_LABEL_COLUMNS, parseCorpusLabels, type CorpusLabels } from "@/lib/corpusLabels";

export const CORPUS_LABELS_READ_MODEL_VERSION = 21;

const parsed = new WeakMap<object, ReadonlyMap<string, CorpusLabels>>();

export async function corpusLabelColumnsPresent(): Promise<boolean> {
  const names = CORPUS_LABEL_COLUMNS.map((name) => `'${name}'`).join(", ");
  const rows = await memoizedSnapshotQueryRows<{ column_name: string }>("corpus-label-columns", {
    sql:
      "SELECT column_name FROM duckdb_columns()" +
      ` WHERE database_name = 'bench' AND table_name = 'results' AND column_name IN (${names})`,
  });
  if (rows.length === 0) {
    const [metadata] = await memoizedSnapshotQueryRows<{ read_model_version: number }>("corpus-label-read-model", {
      sql: "SELECT read_model_version FROM bench.metadata LIMIT 1",
    });
    if (Number(metadata?.read_model_version ?? 0) >= CORPUS_LABELS_READ_MODEL_VERSION) {
      throw new Error(`the snapshot is read-model ${metadata?.read_model_version} but results carries none of the corpus label columns`);
    }
    return false;
  }
  if (rows.length !== CORPUS_LABEL_COLUMNS.length) {
    const present = new Set(rows.map((row) => row.column_name));
    const missing = CORPUS_LABEL_COLUMNS.filter((name) => !present.has(name));
    throw new Error(`results carries only part of the corpus label columns; missing ${missing.join(", ")}`);
  }
  return true;
}

export async function loadCorpusLabels(): Promise<ReadonlyMap<string, CorpusLabels>> {
  if (!(await corpusLabelColumnsPresent())) return new Map();
  const rows = await memoizedSnapshotQueryRows<Record<string, unknown>>("corpus-labels", {
    sql: `SELECT result_id, ${CORPUS_LABEL_COLUMNS.join(", ")} FROM bench.results`,
  });
  let labels = parsed.get(rows);
  if (labels === undefined) {
    const built = new Map<string, CorpusLabels>();
    for (const row of rows) built.set(String(row.result_id), parseCorpusLabels(row));
    labels = built;
    parsed.set(rows, labels);
  }
  return labels;
}
