import { corpusLabelTexts } from "@/lib/corpusLabels";
import type { CorpusLabelState } from "@/lib/useCorpusLabels";

export function CorpusLabelList({
  state,
  resultId,
  testId = "corpus-labels",
  class: className = "",
}: {
  state: CorpusLabelState;
  resultId: string;
  testId?: string;
  class?: string;
}) {
  if (state.status === "failed") {
    return (
      <p class={`text-xs text-[var(--bb-tone-warning-fg)] ${className}`} role="note" data-testid={`${testId}-failed`}>
        The corpus labels of this snapshot could not be read.
      </p>
    );
  }
  const texts = corpusLabelTexts(state.labels.get(resultId));
  if (texts.length === 0) return null;
  return (
    <ul class={`flex flex-wrap gap-1 ${className}`} data-testid={testId} data-result-id={resultId} aria-label="Corpus labels">
      {texts.map((text) => (
        <li
          key={text}
          class="inline-flex items-center rounded border border-[var(--bb-data-border)] bg-[var(--bb-surface-data-muted)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--bb-data-fg-muted)]"
          data-testid={`${testId}-item`}
        >
          {text}
        </li>
      ))}
    </ul>
  );
}
