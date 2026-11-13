import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildSectionEntries, indexedResults, sectionEntryHref, type SectionEntry } from "@/lib/corpusSummary";
import { formatScaleFactor, formatScoreMetric } from "@/lib/metricFormatters";
import { canonicalBenchmarkSlug, canonicalPhase, formatBenchmarkLabel, formatPhaseWithStreams } from "@/lib/displayLabels";
import { formatTimingExclusion, normalizePrimaryMetric, phaseScoreValue, primaryMetricLabel, primaryMetricValue } from "@/lib/displayEligibility";
import { getBenchmarkRanking, listResults, type BenchmarkRankingRow, type ResultRow } from "@/lib/duckdbQueries";
import { resultReceiptHref } from "@/lib/resultLinks";
import { buildReceipts, type ResultReceipt } from "./result-receipts.ts";
import { platformVersionDisplay } from "@/lib/versionLabel";
import { fmtGeomean } from "@/utils";
import { closeResultsSnapshot, openResultsSnapshot, queryRows } from "./results-db.ts";
import { bundleManifest, siteInputsPath } from "./site-inputs.ts";

export const SUMMARY_ROOT = "/result-summaries";

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

export interface SnapshotIdentity {
  coreSha: string;
  corpusSha: string;
  packageVersion: string;
  producedAt: string | null;
  snapshotSha256: string;
  readModelVersion: number;
  resultCount: number;
}

export interface RunLine {
  resultId: string;
  benchmarkId: string;
  benchmarkLabel: string;
  scale: string;
  phase: string;
  version: string | null;
  runDate: string;
  metricLabel: string;
  score: string;
  geomean: string;
  ranked: boolean;
  rankingStatus: string;
  receiptHref: string;
}

export interface RankingLine {
  rank: number | null;
  platformId: string;
  platformLabel: string;
  version: string | null;
  resultId: string;
  runDate: string;
  score: string;
  geomean: string;
  exclusion: string | null;
  receiptHref: string;
}

export interface BenchmarkCohort {
  scale: string;
  phase: string;
  metricLabel: string;
  ranked: RankingLine[];
}

export interface ExcludedRankingLine extends RankingLine {
  scale: string;
  phase: string;
}

export interface Neighbor {
  id: string;
  label: string;
  runCount: number;
  summaryHref: string;
}

export interface PlatformPage {
  id: string;
  label: string;
  summaryHref: string;
  explorerHref: string;
  resultCount: number;
  latestRun: string;
  benchmarks: Neighbor[];
  ranked: RunLine[];
  excluded: RunLine[];
}

export interface BenchmarkPage {
  id: string;
  label: string;
  summaryHref: string;
  explorerHref: string;
  resultCount: number;
  latestRun: string;
  platforms: Neighbor[];
  cohorts: BenchmarkCohort[];
  excluded: ExcludedRankingLine[];
}

export interface ResultsSummary {
  snapshot: SnapshotIdentity;
  platforms: PlatformPage[];
  benchmarks: BenchmarkPage[];
}

export interface PublishedResults extends ResultsSummary {
  receipts: ResultReceipt[];
}

export type RankingSource = (benchmark: string, scaleFactor: number, phase: string, streamCount: number | null) => Promise<BenchmarkRankingRow[]>;

export function reasonCounts(reasons: readonly string[]): { reason: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const reason of reasons) counts[reason] = (counts[reason] ?? 0) + 1;
  return Object.entries(counts).map(([reason, count]) => ({ reason, count }));
}

export function summaryHref(kind: "platforms" | "benchmarks", id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error(`result summary id is not a safe path segment: ${JSON.stringify(id)}`);
  return `${SUMMARY_ROOT}/${kind}/${id}.html`;
}

function runLine(row: ResultRow): RunLine {
  const phase = canonicalPhase(row.test_type);
  const metric = phase === "throughput" ? "throughput_at_size" : "power_score";
  const benchmarkId = canonicalBenchmarkSlug(row.benchmark);
  return {
    resultId: row.result_id,
    benchmarkId,
    benchmarkLabel: formatBenchmarkLabel(benchmarkId),
    scale: formatScaleFactor(row.scale_factor),
    phase: formatPhaseWithStreams(phase, row.stream_count),
    version: platformVersionDisplay(row).text,
    runDate: row.run_date,
    metricLabel: primaryMetricLabel(metric),
    score: formatScoreMetric(metric, phaseScoreValue(row)),
    geomean: fmtGeomean(row.display_geomean_ms),
    ranked: row.ranking_exclusion_reason === null,
    rankingStatus: row.ranking_exclusion_reason === null ? "Ranked" : formatTimingExclusion(row.ranking_exclusion_reason),
    receiptHref: resultReceiptHref(row),
  };
}

function rankingLine(row: BenchmarkRankingRow): RankingLine {
  const metric = normalizePrimaryMetric(row.primary_metric);
  const value = primaryMetricValue(row, metric);
  return {
    rank: row.rank,
    platformId: row.platform_id,
    platformLabel: row.platform,
    version: platformVersionDisplay(row).text,
    resultId: row.result_id,
    runDate: row.run_date,
    score: metric === "display_geomean_ms" ? fmtGeomean(value) : formatScoreMetric(metric, value),
    geomean: fmtGeomean(row.display_geomean_ms),
    exclusion: row.ranking_exclusion_reason === null ? null : formatTimingExclusion(row.ranking_exclusion_reason),
    receiptHref: resultReceiptHref(row),
  };
}

function neighbors(rows: readonly ResultRow[], kind: "platforms" | "benchmarks", idOf: (row: ResultRow) => string, labelOf: (row: ResultRow) => string): Neighbor[] {
  const counts = new Map<string, { label: string; runCount: number }>();
  for (const row of rows) {
    const id = idOf(row);
    const entry = counts.get(id) ?? { label: labelOf(row), runCount: 0 };
    entry.runCount += 1;
    counts.set(id, entry);
  }
  return [...counts]
    .map(([id, entry]) => ({ id, label: entry.label, runCount: entry.runCount, summaryHref: summaryHref(kind, id) }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function byRunOrder(left: RunLine, right: RunLine): number {
  return left.benchmarkLabel.localeCompare(right.benchmarkLabel) || left.scale.localeCompare(right.scale, "en", { numeric: true }) || right.runDate.localeCompare(left.runDate);
}

function cohortsOf(rows: readonly ResultRow[]): { scaleFactor: number; phase: string; streamCount: number | null }[] {
  const seen = new Map<string, { scaleFactor: number; phase: string; streamCount: number | null }>();
  for (const row of rows) {
    const cohort = { scaleFactor: row.scale_factor, phase: canonicalPhase(row.test_type), streamCount: row.stream_count ?? null };
    seen.set(JSON.stringify(cohort), cohort);
  }
  return [...seen.values()].sort((left, right) => left.scaleFactor - right.scaleFactor || left.phase.localeCompare(right.phase) || (left.streamCount ?? 0) - (right.streamCount ?? 0));
}

export async function buildResultsSummary(
  allRows: readonly ResultRow[],
  ranking: RankingSource,
  snapshot: Omit<SnapshotIdentity, "resultCount">,
): Promise<ResultsSummary> {
  const rows = indexedResults(allRows);
  const platformEntries = buildSectionEntries(rows, "platforms");
  const benchmarkEntries = buildSectionEntries(rows, "benchmarks");

  const platforms = platformEntries.map((entry: SectionEntry): PlatformPage => {
    const own = rows.filter((row) => row.platform_id === entry.id);
    const runs = own.map(runLine).sort(byRunOrder);
    return {
      id: entry.id,
      label: entry.label,
      summaryHref: summaryHref("platforms", entry.id),
      explorerHref: sectionEntryHref("platforms", entry.id),
      resultCount: entry.resultCount,
      latestRun: entry.latestRun,
      benchmarks: neighbors(own, "benchmarks", (row) => canonicalBenchmarkSlug(row.benchmark), (row) => formatBenchmarkLabel(canonicalBenchmarkSlug(row.benchmark))),
      ranked: runs.filter((run) => run.ranked),
      excluded: runs.filter((run) => !run.ranked),
    };
  });

  const benchmarks: BenchmarkPage[] = [];
  for (const entry of benchmarkEntries) {
    const own = rows.filter((row) => canonicalBenchmarkSlug(row.benchmark) === entry.id);
    const admitted = new Set(own.map((row) => row.result_id));
    const cohorts: BenchmarkCohort[] = [];
    const excluded: ExcludedRankingLine[] = [];
    for (const cohort of cohortsOf(own)) {
      const lines = (await ranking(entry.id, cohort.scaleFactor, cohort.phase, cohort.streamCount)).filter((row) => admitted.has(row.result_id));
      if (lines.length === 0) continue;
      const scale = formatScaleFactor(cohort.scaleFactor);
      const phase = formatPhaseWithStreams(cohort.phase, cohort.streamCount);
      const rendered = lines.map(rankingLine);
      excluded.push(...rendered.filter((line) => line.exclusion !== null).map((line) => ({ ...line, scale, phase })));
      const ranked = rendered.filter((line) => line.exclusion === null);
      if (ranked.length === 0) continue;
      const metric = normalizePrimaryMetric(lines[0]!.primary_metric);
      cohorts.push({ scale, phase, metricLabel: primaryMetricLabel(metric), ranked });
    }
    benchmarks.push({
      id: entry.id,
      label: entry.label,
      summaryHref: summaryHref("benchmarks", entry.id),
      explorerHref: sectionEntryHref("benchmarks", entry.id),
      resultCount: entry.resultCount,
      latestRun: entry.latestRun,
      platforms: neighbors(own, "platforms", (row) => row.platform_id, (row) => row.platform),
      cohorts,
      excluded,
    });
  }

  return {
    snapshot: { ...snapshot, resultCount: rows.length },
    platforms: platforms.sort((left, right) => left.label.localeCompare(right.label)),
    benchmarks: benchmarks.sort((left, right) => left.label.localeCompare(right.label)),
  };
}

export function snapshotFile(): string {
  return siteInputsPath("explorer", "results.duckdb");
}

export function fileSha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

let loaded: Promise<PublishedResults> | undefined;

export function loadResultsSummary(): Promise<PublishedResults> {
  loaded ??= (async () => {
    const file = snapshotFile();
    await openResultsSnapshot(file);
    try {
      const manifest = bundleManifest();
      const [{ read_model_version: readModelVersion }] = await queryRows<{ read_model_version: number }>("SELECT read_model_version FROM bench.metadata");
      const snapshotSha256 = fileSha256(file);
      if (!manifest.produced_at) throw new Error("The core bundle manifest has no produced_at, so the result pages cannot state a snapshot date.");
      const results = await listResults();
      const summary = await buildResultsSummary(results, getBenchmarkRanking, {
        coreSha: manifest.core_sha,
        corpusSha: manifest.corpus_sha,
        packageVersion: manifest.package_version,
        producedAt: manifest.produced_at,
        snapshotSha256,
        readModelVersion,
      });
      const receipts = await buildReceipts(indexedResults(results), { snapshotSha256, snapshotDate: manifest.produced_at.slice(0, 10) });
      return { ...summary, receipts };
    } finally {
      closeResultsSnapshot();
    }
  })();
  return loaded;
}
