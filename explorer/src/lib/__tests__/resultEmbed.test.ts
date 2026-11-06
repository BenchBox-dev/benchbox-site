// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { formatPrimaryMetric, primaryMetricLabel } from "@/lib/displayEligibility";
import { canonicalPhase } from "@/lib/displayLabels";
import { getBenchmarkRanking, getDetailResult, getPrimaryMetricForBenchmark, getResultDetailMetrics } from "@/lib/duckdbQueries";
import { loadEmbedResult, loadEmbedResults, presentEmbedResult } from "@/lib/resultEmbed";
import { openSnapshot, type SnapshotDb } from "@/testing/snapshotDb";
import { siteInputsPath } from "@/test/siteInputs";

const snapshot = vi.hoisted(() => ({ current: null as SnapshotDb | null }));

vi.mock("@/db", () => ({
  queryRows: (sql: string, params: unknown[] = []) => snapshot.current!.queryRows(sql, params),
}));

let resultIds: string[] = [];

beforeAll(async () => {
  snapshot.current = await openSnapshot(siteInputsPath("explorer", "results.duckdb"));
  resultIds = (await snapshot.current.queryRows<{ result_id: string }>("SELECT result_id FROM bench.results ORDER BY result_id")).map((row) => row.result_id);
});

afterAll(() => {
  snapshot.current?.close();
});

describe("embed metric values match the Explorer for the same snapshot", () => {
  it("shows the primary metric exactly as the result detail page formats it, for every published result", async () => {
    expect(resultIds.length).toBeGreaterThan(0);
    for (const resultId of resultIds) {
      const detail = await getDetailResult(resultId);
      const metric = await getPrimaryMetricForBenchmark(detail!.benchmark, canonicalPhase(detail!.test_type));
      const embedded = await loadEmbedResult(resultId);
      expect(embedded.state).toBe("published");
      if (embedded.state !== "published") continue;
      expect(embedded.metric.id).toBe(metric);
      expect(embedded.metric.label).toBe(primaryMetricLabel(metric));
      expect(embedded.metric.text).toBe(formatPrimaryMetric(detail!, metric));
      expect(embedded.platform).toBe(detail!.platform);
      expect(embedded.ranked).toBe(detail!.ranking_exclusion_reason === null);
    }
  }, 120_000);

  it("shows the same metric text as the benchmark ranking table for ranked rows", async () => {
    const cohorts = await snapshot.current!.queryRows<{ benchmark: string; scale_factor: number; phase: string }>(
      "SELECT benchmark, scale_factor, phase FROM bench.benchmark_rankings GROUP BY ALL ORDER BY count(*) DESC LIMIT 1",
    );
    const cohort = cohorts[0]!;
    const rows = await getBenchmarkRanking(cohort.benchmark, cohort.scale_factor, cohort.phase);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      const embedded = await loadEmbedResult(row.result_id);
      if (embedded.state !== "published") throw new Error(`${row.result_id} was not published`);
      expect(embedded.metric.text).toBe(formatPrimaryMetric(row, embedded.metric.id));
    }
  });

  it("loads several results in the order requested", async () => {
    const wanted = [resultIds[3]!, resultIds[1]!];
    expect((await loadEmbedResults(wanted)).map((result) => result.resultId)).toEqual(wanted);
  });
});

describe("withdrawn results", () => {
  it("renders an id that the published snapshot does not contain as withdrawn", async () => {
    expect(await loadEmbedResult("tpch-duckdb-sf1.0-20200101-00000000")).toEqual({
      state: "withdrawn",
      resultId: "tpch-duckdb-sf1.0-20200101-00000000",
      cause: "absent",
    });
  });

  it("renders a result whose visibility is not public as withdrawn, and never as published", async () => {
    const row = await getResultDetailMetrics(resultIds[0]!);
    for (const visibility of ["internal", "local-preview"]) {
      expect(presentEmbedResult(row!.result_id, { ...row!, visibility }, "power_score")).toEqual({
        state: "withdrawn",
        resultId: row!.result_id,
        cause: "not-public",
      });
    }
    expect(presentEmbedResult(row!.result_id, row!, "power_score").state).toBe("published");
  });
});
