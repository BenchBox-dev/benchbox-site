import type { Citation } from "../../lib/results-embed.ts";
import { useLiveResults, type LoadResults } from "./useLiveResults.ts";
import { CitedResultView } from "./views.tsx";

export default function CitedResult({ citation, load }: { citation: Citation; load?: LoadResults }) {
  const live = useLiveResults([citation.result], load);
  return <CitedResultView citation={citation} live={live} />;
}
