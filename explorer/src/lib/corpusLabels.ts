export const CORPUS_CLASSES = [
  "full_spec",
  "partial",
  "power_only",
  "throughput_only",
  "subscale",
  "nonstandard_scale",
  "none",
] as const;

export const CORPUS_LANES = ["combined", "power_only", "throughput", "subscale", "own"] as const;

export const CORPUS_LABEL_COLUMNS = [
  "corpus_class",
  "corpus_lanes",
  "corpus_labels",
  "row_count_evidence_label",
  "iteration_label",
] as const;

export type CorpusClass = (typeof CORPUS_CLASSES)[number];
export type CorpusLane = (typeof CORPUS_LANES)[number];

export interface CorpusLabels {
  corpusClass: CorpusClass;
  lanes: CorpusLane[];
  sentences: string[];
  rowCounts: string | null;
  iteration: string | null;
}

export class CorpusLabelError extends Error {
  constructor(resultId: string, message: string) {
    super(`corpus labels of result ${resultId}: ${message}`);
    this.name = "CorpusLabelError";
  }
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function jsonArray(resultId: string, column: string, value: unknown): unknown[] {
  if (typeof value !== "string") throw new CorpusLabelError(resultId, `${column} must be a JSON array string`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new CorpusLabelError(resultId, `${column} is not valid JSON`);
  }
  if (!Array.isArray(parsed)) throw new CorpusLabelError(resultId, `${column} must be a JSON array`);
  return parsed;
}

function optionalText(resultId: string, column: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.trim() === "") throw new CorpusLabelError(resultId, `${column} must be non-empty text or null`);
  return value;
}

export function parseCorpusLabels(row: Record<string, unknown>): CorpusLabels {
  const resultId = String(row.result_id);
  if (!oneOf(CORPUS_CLASSES, row.corpus_class)) {
    throw new CorpusLabelError(resultId, `corpus_class ${JSON.stringify(row.corpus_class)} is not one of ${CORPUS_CLASSES.join(", ")}`);
  }
  const lanes = jsonArray(resultId, "corpus_lanes", row.corpus_lanes).map((lane) => {
    if (!oneOf(CORPUS_LANES, lane)) throw new CorpusLabelError(resultId, `lane ${JSON.stringify(lane)} is not one of ${CORPUS_LANES.join(", ")}`);
    return lane;
  });
  const sentences = jsonArray(resultId, "corpus_labels", row.corpus_labels).map((sentence) => {
    if (typeof sentence !== "string" || sentence.trim() === "") throw new CorpusLabelError(resultId, "corpus_labels holds only non-empty sentences");
    return sentence;
  });
  return {
    corpusClass: row.corpus_class,
    lanes,
    sentences,
    rowCounts: optionalText(resultId, "row_count_evidence_label", row.row_count_evidence_label),
    iteration: optionalText(resultId, "iteration_label", row.iteration_label),
  };
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function corpusLabelTexts(labels: CorpusLabels | undefined): string[] {
  if (labels === undefined) return [];
  const texts = [...labels.sentences];
  for (const extra of [labels.rowCounts, labels.iteration]) {
    if (extra === null) continue;
    const text = sentenceCase(extra);
    if (!texts.some((existing) => existing.toLowerCase() === text.toLowerCase())) texts.push(text);
  }
  return texts;
}
