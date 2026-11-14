import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalBenchmarkSlug } from "@/lib/displayLabels";
import { getBenchmarkRanking, listResults, type ResultRow } from "@/lib/duckdbQueries";
import { formatScoreMetric } from "@/lib/metricFormatters";
import { fmtGeomean } from "@/utils";
import { closeResultsSnapshot, openResultsSnapshot, queryRows } from "../src/lib/results-db.ts";
import { buildReceipts } from "../src/lib/result-receipts.ts";
import { buildResultsSummary, snapshotFile, summaryHref, type ResultsSummary } from "../src/lib/results-summary.ts";

const identity = { coreSha: "c".repeat(40), corpusSha: "d".repeat(40), packageVersion: "0.0.0", producedAt: null, snapshotSha256: "e".repeat(64), readModelVersion: 18 };

let rows: ResultRow[];
let summary: ResultsSummary;

beforeAll(async () => {
  await openResultsSnapshot(snapshotFile());
  rows = await listResults();
  summary = await buildResultsSummary(rows, getBenchmarkRanking, identity);
});

afterAll(() => closeResultsSnapshot());

describe("summary pages and the Explorer for one snapshot", () => {
  it("covers exactly the platforms and benchmarks the snapshot publishes", async () => {
    const platforms = await queryRows<{ id: string }>("SELECT DISTINCT platform_id AS id FROM bench.results WHERE visibility LIKE 'public-%'");
    const benchmarks = await queryRows<{ id: string }>("SELECT DISTINCT benchmark AS id FROM bench.results WHERE visibility LIKE 'public-%'");
    expect(summary.platforms.map((page) => page.id).sort()).toEqual(platforms.map((row) => row.id).sort());
    expect(summary.benchmarks.map((page) => page.id).sort()).toEqual([...new Set(benchmarks.map((row) => canonicalBenchmarkSlug(row.id)))].sort());
    expect(summary.snapshot.resultCount).toBe(rows.length);
  });

  it("counts every published run on both views of it", () => {
    expect(summary.platforms.reduce((total, page) => total + page.resultCount, 0)).toBe(rows.length);
    expect(summary.benchmarks.reduce((total, page) => total + page.resultCount, 0)).toBe(rows.length);
    for (const page of summary.platforms) expect(page.ranked.length + page.excluded.length).toBe(page.resultCount);
  });

  it("keeps only ranked runs in the ranked views and every other run in the excluded views", () => {
    for (const page of summary.platforms) {
      expect(page.ranked.every((run) => run.ranked && run.rankingStatus === "Ranked")).toBe(true);
      expect(page.excluded.every((run) => !run.ranked && run.rankingStatus !== "Ranked")).toBe(true);
    }
    for (const page of summary.benchmarks) {
      expect(page.cohorts.every((cohort) => cohort.ranked.every((line) => line.exclusion === null))).toBe(true);
      expect(page.excluded.every((line) => line.exclusion !== null)).toBe(true);
    }
  });

  it("loses no ranking line when a benchmark's excluded lines move to their own section", async () => {
    const stored = await queryRows<{ benchmark: string; lines: number }>(
      "SELECT r.benchmark AS benchmark, count(*)::INTEGER AS lines FROM bench.benchmark_rankings r JOIN bench.results s USING (result_id) WHERE s.visibility LIKE 'public-%' GROUP BY r.benchmark",
    );
    for (const page of summary.benchmarks) {
      const expected = stored.filter((row) => canonicalBenchmarkSlug(row.benchmark) === page.id).reduce((total, row) => total + row.lines, 0);
      const shown = page.cohorts.reduce((total, cohort) => total + cohort.ranked.length, 0) + page.excluded.length;
      expect(shown, page.id).toBe(expected);
    }
  });

  it("builds one receipt per published result, each stating the fields a reader needs", async () => {
    const receipts = await buildReceipts(rows, { snapshotSha256: identity.snapshotSha256, snapshotDate: "2026-11-13" });
    expect(receipts.map((receipt) => receipt.resultId).sort()).toEqual(rows.map((row) => row.result_id).sort());
    for (const receipt of receipts) {
      const labels = receipt.sections.flatMap((section) => section.rows.map((row) => row.label));
      for (const label of ["Benchmark", "Platform", "Platform version", "Scale factor", "Phase", "Run date", "Geomean query time", "Ranking status", "Ranking reason", "Trust label", "Tuning mode", "Execution mode", "Bundle JSON"]) {
        expect(labels, receipt.resultId).toContain(label);
      }
      expect(receipt.citeLine).toContain(identity.snapshotSha256);
      expect(receipt.citeLine).toContain("2026-11-13");
    }
  });

  it("shows the ranking values the Explorer's ranking table holds", async () => {
    const stored = await queryRows<{ benchmark: string; scale_factor: number; result_id: string; rank: number; power_score: number; display_geomean_ms: number; primary_metric: string }>(
      "SELECT benchmark, scale_factor, result_id, rank, power_score, display_geomean_ms, primary_metric FROM bench.benchmark_rankings WHERE phase = 'power' AND stream_count IS NULL AND rank = 1",
    );
    let compared = 0;
    for (const best of stored) {
      const page = summary.benchmarks.find((candidate) => candidate.id === canonicalBenchmarkSlug(best.benchmark));
      const cohort = page?.cohorts.find((candidate) => candidate.scale === `SF ${best.scale_factor}` && candidate.phase === "power");
      const line = cohort?.ranked.find((candidate) => candidate.resultId === best.result_id);
      expect(line, `${best.benchmark} SF ${best.scale_factor} rank 1`).toBeDefined();
      expect(line?.rank).toBe(1);
      if (best.primary_metric === "power_score") expect(line?.score).toBe(formatScoreMetric("power_score", best.power_score));
      expect(line?.geomean).toBe(fmtGeomean(best.display_geomean_ms));
      compared += 1;
    }
    expect(compared).toBeGreaterThan(0);
  });

  it("shows a run's score and geometric mean as the results table holds them", async () => {
    const stored = await queryRows<{ result_id: string; platform_id: string; power_score: number; display_geomean_ms: number }>(
      "SELECT result_id, platform_id, power_score, display_geomean_ms FROM bench.results WHERE test_type = 'power' AND power_score IS NOT NULL LIMIT 25",
    );
    for (const row of stored) {
      const page = summary.platforms.find((candidate) => candidate.id === row.platform_id);
      const run = [...(page?.ranked ?? []), ...(page?.excluded ?? [])].find((candidate) => candidate.resultId === row.result_id);
      expect(run?.score).toBe(formatScoreMetric("power_score", row.power_score));
      expect(run?.geomean).toBe(fmtGeomean(row.display_geomean_ms));
    }
  });

  it("links each page to the Explorer view of the same id", () => {
    const platform = summary.platforms[0]!;
    expect(platform.explorerHref).toBe(`/results/p/${platform.id}/`);
    expect(platform.summaryHref).toBe(`/result-summaries/platforms/${platform.id}.html`);
    const benchmark = summary.benchmarks[0]!;
    expect(benchmark.explorerHref).toBe(`/results/${benchmark.id}/`);
    expect(benchmark.summaryHref).toBe(`/result-summaries/benchmarks/${benchmark.id}.html`);
  });

  it("refuses an id that cannot be a single path segment", () => {
    expect(() => summaryHref("platforms", "../escape")).toThrow(/safe path segment/);
    expect(() => summaryHref("benchmarks", "a/b")).toThrow(/safe path segment/);
  });
});

describe("withdrawn and unpublished results", () => {
  const sourcePlatform = () => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.platform_id, (counts.get(row.platform_id) ?? 0) + 1);
    return [...counts].sort((left, right) => left[1] - right[1])[0]![0];
  };

  function mentions(built: ResultsSummary, platformId: string, resultIds: Set<string>): boolean {
    return (
      built.platforms.some((page) => page.id === platformId) ||
      built.benchmarks.some(
        (page) =>
          page.platforms.some((neighbor) => neighbor.id === platformId) ||
          page.cohorts.some((cohort) => cohort.ranked.some((line) => line.platformId === platformId || resultIds.has(line.resultId))) ||
          page.excluded.some((line) => line.platformId === platformId || resultIds.has(line.resultId)),
      )
    );
  }

  it("leaves no page or ranking line for a platform whose results left the snapshot", async () => {
    const platformId = sourcePlatform();
    const withdrawn = new Set(rows.filter((row) => row.platform_id === platformId).map((row) => row.result_id));
    expect(mentions(summary, platformId, withdrawn)).toBe(true);
    const rebuilt = await buildResultsSummary(
      rows.filter((row) => row.platform_id !== platformId),
      getBenchmarkRanking,
      identity,
    );
    expect(mentions(rebuilt, platformId, withdrawn)).toBe(false);
    expect(rebuilt.snapshot.resultCount).toBe(rows.length - withdrawn.size);
  });

  it("omits a result whose visibility is not public even when rankings still list it", async () => {
    const platformId = sourcePlatform();
    const hidden = new Set(rows.filter((row) => row.platform_id === platformId).map((row) => row.result_id));
    const rebuilt = await buildResultsSummary(
      rows.map((row) => (hidden.has(row.result_id) ? { ...row, visibility: "withdrawn" } : row)),
      getBenchmarkRanking,
      identity,
    );
    expect(mentions(rebuilt, platformId, hidden)).toBe(false);
  });
});
