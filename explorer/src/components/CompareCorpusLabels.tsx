import { CorpusLabelList } from "@/components/CorpusLabelList";
import { corpusLabelTexts } from "@/lib/corpusLabels";
import { visibleResultIdForRow } from "@/lib/resultLinks";
import type { CorpusLabelState } from "@/lib/useCorpusLabels";
import type { DetailResult } from "@/types";

export function CompareCorpusLabels({ results, state }: { results: readonly DetailResult[]; state: CorpusLabelState }) {
  if (state.status === "failed") {
    return (
      <p class="mb-4 text-xs text-[var(--bb-tone-warning-fg)]" role="note" data-testid="compare-corpus-labels-failed">
        The corpus labels of this snapshot could not be read.
      </p>
    );
  }
  const labelled = results.filter((result) => corpusLabelTexts(state.labels.get(result.result_id)).length > 0);
  if (labelled.length === 0) return null;
  return (
    <section class="mb-4" aria-label="Corpus labels of the compared runs" data-testid="compare-corpus-labels">
      <ul class="grid gap-2 text-xs text-[var(--bb-fg-muted)]">
        {labelled.map((result) => (
          <li key={result.result_id} data-testid={`compare-corpus-labels-run-${result.result_id}`}>
            <span class="font-medium text-[var(--bb-fg-primary)]">
              {result.platform} · {visibleResultIdForRow(result)}
            </span>
            <CorpusLabelList
              state={state}
              resultId={result.result_id}
              testId={`compare-corpus-labels-${result.result_id}`}
              class="mt-1"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
