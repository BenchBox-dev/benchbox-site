import { describe, expect, it } from "vitest";
import {
  normalizePrimaryMetric,
  phaseScoreValue,
  primaryMetricLabel,
  primaryMetricValue,
  rankingScoreMetric,
  secondaryScoreMetrics,
} from "@/lib/displayEligibility";
import { combinedDisclosures, parseJsonColumn } from "@/lib/combinedDisclosure";

describe("combined cohort metrics", () => {
  it("labels and reads QphH@Size and QphDS@SF", () => {
    expect(normalizePrimaryMetric("qphh_at_size")).toBe("qphh_at_size");
    expect(normalizePrimaryMetric("qphds_at_size")).toBe("qphds_at_size");
    expect(primaryMetricLabel("qphh_at_size")).toBe("QphH@Size");
    expect(primaryMetricLabel("qphds_at_size")).toBe("QphDS@SF");
    const row = { power_score: 10, throughput_at_size: 20, qphh_at_size: 30, qphds_at_size: null, display_geomean_ms: 5 };
    expect(primaryMetricValue(row, "qphh_at_size")).toBe(30);
    expect(rankingScoreMetric("qphds_at_size")).toBe("qphds_at_size");
  });

  it("shows power and throughput as secondary metrics only for composites", () => {
    expect(secondaryScoreMetrics("qphh_at_size")).toEqual(["power_score", "throughput_at_size"]);
    expect(secondaryScoreMetrics("power_score")).toEqual([]);
  });

  it("scores combined phase rows on the composite and power rows on power", () => {
    expect(phaseScoreValue({ phase: "combined", power_score: 1, qphh_at_size: 9 })).toBe(9);
    expect(phaseScoreValue({ phase: "power", power_score: 1, qphh_at_size: 9 })).toBe(1);
  });

  it("describes non-transactional steps and load scope", () => {
    const steps = parseJsonColumn<Record<string, boolean>>('{"RF1":false,"RF2":false}');
    const scope = parseJsonColumn<string[]>('["data_loading","merge_settle"]');
    const notes = combinedDisclosures({ transactional_steps: steps, load_scope: scope });
    expect(notes[0]).toContain("RF1 and RF2 ran without a transaction");
    expect(notes[1]).toBe("Load time includes data loading and merge settle.");
    expect(combinedDisclosures({ transactional_steps: null, load_scope: null })).toEqual([]);
  });
});
