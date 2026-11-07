import { describe, expect, it } from "vitest";
import duckdbMultiStream from "@/lib/__tests__/fixtures/plans/duckdb-multi-stream.plans.json";
import fingerprintVaried from "@/lib/__tests__/fixtures/plans/duckdb-fingerprint-varied.plans.json";
import pandasErrorsOnly from "@/lib/__tests__/fixtures/plans/pandas-errors-only.plans.json";
import polarsText from "@/lib/__tests__/fixtures/plans/polars-text.plans.json";
import sqliteMultiTable from "@/lib/__tests__/fixtures/plans/sqlite-multi-table.plans.json";
import {
  captureErrorsForQuery,
  groupCaptureErrors,
  normalizeQueryIdForMatch,
  parseQueryPlanDocument,
  plansForQuery,
} from "@/lib/queryPlans";

describe("parseQueryPlanDocument", () => {
  it("reads the exported QueryPlanDAG shape as an operator tree", () => {
    const parsed = parseQueryPlanDocument({
      version: "1.0",
      capture_failures: 1,
      truncated: true,
      queries: {
        Q1: {
          plan_format: "dag",
          plan: {
            query_id: "Q1",
            platform: "duckdb",
            estimated_rows: 42,
            estimated_cost: 3.5,
            plan_fingerprint: "abc123",
            logical_root: {
              operator_type: "Join",
              join_type: "inner",
              join_conditions: ["l_orderkey = o_orderkey"],
              children: [
                {
                  operator_type: "Scan",
                  table_name: "lineitem",
                  physical_operator: { operator_type: "TABLE_SCAN" },
                  children: [],
                },
              ],
            },
            raw_explain_output: "HASH_JOIN\n  TABLE_SCAN lineitem",
          },
        },
      },
    });

    expect(parsed.captureFailures).toBe(1);
    expect(parsed.truncated).toBe(true);
    expect(parsed.plans).toHaveLength(1);
    expect(parsed.plans[0]).toMatchObject({
      label: "Q1",
      platform: "duckdb",
      estimatedRows: "42",
      estimatedCost: "3.5",
      fingerprint: "abc123",
      textualPlan: "HASH_JOIN\n  TABLE_SCAN lineitem",
    });
    expect(parsed.plans[0]?.root).toMatchObject({
      operator: "Join",
      details: ["Join: inner", "Join conditions: [\"l_orderkey = o_orderkey\"]"],
      children: [{
        operator: "Scan",
        details: ["Table: lineitem", "Physical operator: TABLE_SCAN"],
      }],
    });
  });

  it("accepts the query list and text plan shape used by the pipeline fixture", () => {
    const parsed = parseQueryPlanDocument({
      queries: [{ query_id: "Q1", plan: "SCAN tpch.lineitem" }],
    });

    expect(parsed.plans).toEqual([
      expect.objectContaining({ id: "Q1", label: "Q1", root: null, textualPlan: "SCAN tpch.lineitem" }),
    ]);
  });

  it("shows unknown plan objects as text and bounds the operator tree", () => {
    const parsed = parseQueryPlanDocument({
      queries: {
        malformed: { plan: { unexpected: true } },
        Q2: {
          plan: {
            logical_root: {
              operator_type: "Root",
              children: Array.from({ length: 550 }, (_, index) => ({
                operator_type: `Scan ${index}`,
                children: [],
              })),
            },
          },
        },
      },
    });

    expect(parsed.plans).toHaveLength(2);
    expect(parsed.plans[0]).toMatchObject({ textualPlan: '{"unexpected":true}' });
    expect(parsed.plans[1]?.root?.children).toHaveLength(499);
    expect(parsed.plans[1]?.root?.omittedChildren).toBe(51);
  });
});

describe("normalizeQueryIdForMatch", () => {
  it("treats Q-prefixed and bare numeric query ids as the same query", () => {
    expect(normalizeQueryIdForMatch("Q18")).toBe(normalizeQueryIdForMatch("18"));
    expect(normalizeQueryIdForMatch("q18")).toBe("18");
    expect(normalizeQueryIdForMatch("Q018")).toBe("18");
    expect(normalizeQueryIdForMatch(" 18 ")).toBe("18");
  });

  it("drops an iteration or stream suffix and keeps named query ids", () => {
    expect(normalizeQueryIdForMatch("Q18#2")).toBe("18");
    expect(normalizeQueryIdForMatch("Aggregation_Distinct_GroupBy")).toBe("aggregation_distinct_groupby");
  });
});

describe("plansForQuery", () => {
  it("returns only the plans whose query id matches, in either id style", () => {
    const document = parseQueryPlanDocument({
      queries: {
        "Q18#1": { plan: { query_id: "Q18", logical_root: { operator_type: "Aggregate", children: [] } } },
        "19": { plan: { query_id: "19", logical_root: { operator_type: "Filter", children: [] } } },
        Q2: { plan: { query_id: "Q2", logical_root: { operator_type: "Scan", children: [] } } },
      },
    });

    expect(document.plans.map((plan) => plan.queryId)).toEqual(["19", "Q18", "Q2"]);
    expect(plansForQuery(document.plans, "18").map((plan) => plan.id)).toEqual(["Q18#1"]);
    expect(plansForQuery(document.plans, "Q19").map((plan) => plan.id)).toEqual(["19"]);
    expect(plansForQuery(document.plans, "7")).toEqual([]);
  });
});

describe("plans companions written by core", () => {
  it("keeps one plan per stream and test type for a multi-stream DuckDB run", () => {
    const parsed = parseQueryPlanDocument(duckdbMultiStream);

    expect(parsed.captureFailures).toBe(0);
    expect(parsed.captureErrors).toEqual([]);
    expect(parsed.plans.map((plan) => [plan.id, plan.label])).toEqual([
      ["Q1#0:power", "Q1 · stream 0 · power"],
      ["Q1#1:throughput", "Q1 · stream 1 · throughput"],
      ["Q1#2:throughput", "Q1 · stream 2 · throughput"],
    ]);
    expect(parsed.plans[0]).toMatchObject({
      queryId: "1",
      platform: "duckdb",
      runType: "measurement",
      iteration: "3",
      variants: [],
    });
    expect(parsed.plans[0]?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.plans[0]?.root?.operator).toBe("Project");
    expect(plansForQuery(parsed.plans, "Q1")).toHaveLength(3);
    expect(plansForQuery(parsed.plans, "6")).toEqual([]);
  });

  it("reads the plan text of a Polars run and not the serialized plan object", () => {
    const parsed = parseQueryPlanDocument(polarsText);

    expect(parsed.plans.map((plan) => [plan.id, plan.label, plan.queryId])).toEqual([
      ["Q1#0:", "Q1 · stream 0", "Q1#0:"],
      ["Q3#0:", "Q3 · stream 0", "Q3#0:"],
      ["Q6#0:", "Q6 · stream 0", "Q6#0:"],
    ]);
    const q3 = plansForQuery(parsed.plans, "3");
    expect(q3).toHaveLength(1);
    expect(q3[0]).toMatchObject({ root: null, fingerprint: null, platform: "polars" });
    expect(q3[0]?.textualPlan).toMatch(/^SORT BY \[slice/);
    expect(q3[0]?.textualPlan).not.toContain("plan_data");
    expect(q3[0]?.textualPlan).not.toContain("/Users/");
  });

  it("reports capture errors for a run that captured no plans", () => {
    const parsed = parseQueryPlanDocument(pandasErrorsOnly);

    expect(parsed.plans).toEqual([]);
    expect(parsed.captureFailures).toBe(3);
    expect(parsed.captureErrors).toHaveLength(9);
    expect(parsed.captureErrors[0]).toEqual({
      queryId: "Q1",
      streamId: "0",
      iteration: "1",
      message: "Pandas is an eager DataFrame engine with no query plan to capture",
    });
    expect(groupCaptureErrors(parsed.captureErrors).map((group) => [group.queryId, group.iterations])).toEqual([
      ["Q1", ["1", "2", "3"]],
      ["Q3", ["1", "2", "3"]],
      ["Q6", ["1", "2", "3"]],
    ]);
    expect(captureErrorsForQuery(parsed.captureErrors, "3")).toHaveLength(3);
  });

  it("keeps the branching SQLite plan under its synthetic root", () => {
    const parsed = parseQueryPlanDocument(sqliteMultiTable);

    expect(parsed.plans.map((plan) => plan.id)).toEqual(["Q1#0:power", "Q3#0:power", "Q6#0:power"]);
    const q3 = plansForQuery(parsed.plans, "Q3")[0];
    expect(q3?.root?.operator).toBe("Other");
    expect(q3?.root?.children.map((child) => [child.operator, child.details.join("; ")])).toEqual([
      ["Scan", "Table: customer; Physical operator: SCAN"],
      ["Scan", "Table: orders; Physical operator: INDEX_SCAN"],
      ["Scan", "Table: lineitem; Physical operator: INDEX_SCAN"],
      ["Aggregate", "Physical operator: AGGREGATE"],
      ["Sort", "Physical operator: SORT"],
    ]);
    expect(q3?.textualPlan).toContain("SEARCH orders USING INDEX");
  });

  it("lists the distinct fingerprints of a plan that changed between executions", () => {
    const parsed = parseQueryPlanDocument(fingerprintVaried);

    expect(parsed.plans).toHaveLength(1);
    expect(parsed.plans[0]?.variants).toEqual([
      { fingerprint: "a1f0c3d2".repeat(8), iteration: "1", runType: "measurement" },
      { fingerprint: "9b7e5d41".repeat(8), iteration: "2", runType: "measurement" },
    ]);
  });

  it("ignores variants unless the entry is marked as varied and bounds a long list", () => {
    const variants = Array.from({ length: 80 }, (_, index) => ({ fingerprint: `fp${index}`, iteration: index }));
    const parsed = parseQueryPlanDocument({
      queries: {
        Q1: { plan: "SCAN a", fingerprint_variants: variants },
        Q2: { plan: "SCAN b", fingerprint_varied: true, fingerprint_variants: [...variants, { iteration: 1 }, "x"] },
      },
    });

    expect(parsed.plans[0]?.variants).toEqual([]);
    expect(parsed.plans[1]?.variants).toHaveLength(50);
  });

  it("bounds the number and length of capture errors", () => {
    const parsed = parseQueryPlanDocument({
      errors: [
        ...Array.from({ length: 300 }, (_, index) => ({ query_id: `Q${index}`, error: "x".repeat(5000) })),
        null,
      ],
    });

    expect(parsed.captureErrors).toHaveLength(200);
    expect(parsed.captureErrors[0]?.message).toHaveLength(2000);
    expect(parseQueryPlanDocument({ errors: [{ stream_id: 2 }, { error: "boom" }] }).captureErrors).toEqual([
      { queryId: "unknown", streamId: "2", iteration: null, message: "Unknown error" },
      { queryId: "unknown", streamId: null, iteration: null, message: "boom" },
    ]);
  });
});
