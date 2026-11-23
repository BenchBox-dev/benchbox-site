import { useEffect, useState } from "preact/hooks";
import { loadCorpusLabels } from "@/lib/corpusLabelQueries";
import type { CorpusLabels } from "@/lib/corpusLabels";

export type CorpusLabelState =
  | { status: "loading"; labels: ReadonlyMap<string, CorpusLabels> }
  | { status: "ready"; labels: ReadonlyMap<string, CorpusLabels> }
  | { status: "failed"; labels: ReadonlyMap<string, CorpusLabels> };

const NO_LABELS: ReadonlyMap<string, CorpusLabels> = new Map();

export function useCorpusLabels(): CorpusLabelState {
  const [state, setState] = useState<CorpusLabelState>({ status: "loading", labels: NO_LABELS });
  useEffect(() => {
    let cancelled = false;
    loadCorpusLabels().then(
      (labels) => {
        if (!cancelled) setState({ status: "ready", labels });
      },
      (error: unknown) => {
        console.error("corpus labels could not be read from the snapshot", error);
        if (!cancelled) setState({ status: "failed", labels: NO_LABELS });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
