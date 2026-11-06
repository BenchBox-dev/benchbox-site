import { useLiveResults, type LoadResults } from "./useLiveResults.ts";
import { CurrentResultsView } from "./views.tsx";

interface Props {
  results: string[];
  load?: LoadResults;
  liveSnapshot?: string;
}

export default function CurrentResults({ results, load, liveSnapshot = import.meta.env.RESULTS_SNAPSHOT_SHA256 }: Props) {
  const live = useLiveResults(results, load);
  return <CurrentResultsView resultIds={results} live={live} liveSnapshot={liveSnapshot} />;
}
