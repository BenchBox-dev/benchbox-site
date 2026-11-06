import { canonicalPhase, formatTrustLabel, isPublishedVisibility } from "@/lib/displayLabels";
import {
  formatPrimaryMetric,
  formatTimingExclusion,
  isRankable,
  isTimingDisplayable,
  primaryMetricHigherIsBetter,
  primaryMetricLabel,
  type PrimaryMetric,
} from "@/lib/displayEligibility";
import { detailResultFromWideRow, getPrimaryMetricForBenchmark, getResultDetailMetrics, type ResultDetailMetricsRow } from "@/lib/duckdbQueries";
import { formatScaleFactor } from "@/lib/metricFormatters";
import { resultDetailHref } from "@/lib/resultLinks";
import { formatRunDate } from "@/lib/runAge";
import { humanizeBenchmark } from "@/utils";

export interface EmbedMetric {
  id: PrimaryMetric;
  label: string;
  direction: "higher is better" | "lower is better";
  text: string;
}

export interface PublishedEmbedResult {
  state: "published";
  resultId: string;
  platform: string;
  benchmark: string;
  scale: string;
  runDate: string;
  trust: string;
  metric: EmbedMetric;
  ranked: boolean;
  rankingNote: string | null;
  displayNote: string | null;
  href: string;
}

export interface WithdrawnEmbedResult {
  state: "withdrawn";
  resultId: string;
  cause: "absent" | "not-public";
}

export type EmbedResult = PublishedEmbedResult | WithdrawnEmbedResult;

export type EmbedFacts = Pick<PublishedEmbedResult, "platform" | "benchmark" | "scale" | "runDate"> & { metric: EmbedMetric };

export function embedFacts(result: PublishedEmbedResult): EmbedFacts {
  const { platform, benchmark, scale, runDate, metric } = result;
  return { platform, benchmark, scale, runDate, metric };
}

export function presentEmbedResult(resultId: string, row: ResultDetailMetricsRow | null, primaryMetric: PrimaryMetric): EmbedResult {
  if (row === null) return { state: "withdrawn", resultId, cause: "absent" };
  if (!isPublishedVisibility(row.visibility)) return { state: "withdrawn", resultId, cause: "not-public" };
  const detail = detailResultFromWideRow(row, [], []);
  const ranked = isRankable(detail);
  return {
    state: "published",
    resultId,
    platform: detail.platform,
    benchmark: humanizeBenchmark(detail.benchmark),
    scale: formatScaleFactor(detail.scale_factor),
    runDate: formatRunDate(detail.run_date),
    trust: formatTrustLabel(detail.trust_label),
    metric: {
      id: primaryMetric,
      label: primaryMetricLabel(primaryMetric),
      direction: primaryMetricHigherIsBetter(primaryMetric) ? "higher is better" : "lower is better",
      text: formatPrimaryMetric(detail, primaryMetric),
    },
    ranked,
    rankingNote: ranked ? null : formatTimingExclusion(detail.ranking_exclusion_reason, "This result is not included in rankings."),
    displayNote: isTimingDisplayable(detail) ? null : formatTimingExclusion(detail.display_exclusion_reason, "Display timing is unavailable."),
    href: resultDetailHref(resultId),
  };
}

export async function loadEmbedResult(resultId: string): Promise<EmbedResult> {
  const row = await getResultDetailMetrics(resultId);
  if (row === null) return presentEmbedResult(resultId, null, "display_geomean_ms");
  const primaryMetric = await getPrimaryMetricForBenchmark(row.benchmark, canonicalPhase(row.test_type));
  return presentEmbedResult(resultId, row, primaryMetric);
}

export async function loadEmbedResults(resultIds: readonly string[]): Promise<EmbedResult[]> {
  const results: EmbedResult[] = [];
  for (const resultId of resultIds) results.push(await loadEmbedResult(resultId));
  return results;
}
