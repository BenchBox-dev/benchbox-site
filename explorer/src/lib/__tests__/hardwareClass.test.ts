import { describe, expect, it } from "vitest";
import {
  GENERIC_KNOWN_DEFECT_TEXT,
  formatCitationLine,
  formatHardwareBasis,
  formatHardwareClass,
  hardwareClassOptions,
  knownDefectText,
} from "@/lib/hardwareClass";

const ranked = (platform: string, hardwareClass: string | null, exclusion: string | null = null) => ({
  platform_id: platform,
  hardware_class: hardwareClass,
  ranking_exclusion_reason: exclusion,
});

describe("hardwareClassOptions", () => {
  it("keeps only classes with at least three distinct ranked platforms", () => {
    const options = hardwareClassOptions([
      ranked("a", "T2"),
      ranked("b", "T2"),
      ranked("c", "T2"),
      ranked("a", "T2"),
      ranked("a", "T1"),
      ranked("b", "T1"),
    ]);

    expect(options).toEqual([{ value: "T2", platformCount: 3 }]);
  });

  it("does not count unranked results, unclassified-less rows or repeat runs of one platform", () => {
    const options = hardwareClassOptions([
      ranked("a", "T3"),
      ranked("b", "T3"),
      ranked("c", "T3", "known_defective_data"),
      ranked("d", null),
      ranked("a", "T3"),
    ]);

    expect(options).toEqual([]);
  });

  it("separates variants of one platform", () => {
    const options = hardwareClassOptions([
      { ...ranked("clickhouse", "T2"), variant_id: "local" },
      { ...ranked("clickhouse", "T2"), variant_id: "container" },
      ranked("duckdb", "T2"),
    ]);

    expect(options).toEqual([{ value: "T2", platformCount: 3 }]);
  });

  it("counts platforms within one cohort, not across benchmarks", () => {
    const inCohort = (platform: string, benchmark: string) => ({ ...ranked(platform, "T2"), benchmark, scale_factor: 1, test_type: "power" });

    expect(
      hardwareClassOptions([inCohort("a", "tpch"), inCohort("b", "tpch"), inCohort("c", "tpcds"), inCohort("d", "tpcds")]),
    ).toEqual([]);
    expect(
      hardwareClassOptions([inCohort("a", "tpch"), inCohort("b", "tpch"), inCohort("c", "tpch"), inCohort("d", "tpcds")]),
    ).toEqual([{ value: "T2", platformCount: 3 }]);
  });

  it("is empty for a snapshot that predates the hardware columns", () => {
    expect(hardwareClassOptions([{ platform_id: "a" }, { platform_id: "b" }, { platform_id: "c" }])).toEqual([]);
  });
});

describe("hardware labels", () => {
  it("labels tiers with their CPU unit range", () => {
    expect(formatHardwareClass("T2")).toBe("T2 (10 to 40 CPU units)");
    expect(formatHardwareClass("managed")).toBe("Managed service");
    expect(formatHardwareClass("unclassified")).toBe("Unclassified");
  });

  it("describes the basis in words and passes an unknown basis through", () => {
    expect(formatHardwareBasis("attested_model")).toBe("from a CPU model attested by the maintainer");
    expect(formatHardwareBasis("future_basis")).toBe("future basis");
    expect(formatHardwareBasis(null)).toBeNull();
  });
});

describe("knownDefectText", () => {
  it("uses the recorded reason and falls back to the generic text", () => {
    expect(knownDefectText("Scale was wrong.")).toBe("Scale was wrong.");
    expect(knownDefectText(null)).toBe(GENERIC_KNOWN_DEFECT_TEXT);
    expect(knownDefectText("  ")).toBe(GENERIC_KNOWN_DEFECT_TEXT);
  });
});

describe("formatCitationLine", () => {
  const base = {
    publicResultId: "5e453c54",
    permalink: "https://benchbox.dev/results/r/tpch_sf1_doris_sql_20261007_172956_5e453c54",
    accessed: "2026-11-18",
  };

  it("states a recorded version plainly", () => {
    expect(formatCitationLine({ ...base, benchboxVersion: "0.5.1", versionBasis: "recorded" })).toBe(
      "BenchBox 0.5.1, result 5e453c54, https://benchbox.dev/results/r/tpch_sf1_doris_sql_20261007_172956_5e453c54, accessed 2026-11-18. Not an official TPC result.",
    );
  });

  it("marks an inferred version", () => {
    expect(formatCitationLine({ ...base, benchboxVersion: "0.1.5", versionBasis: "inferred_from_run_date" })).toBe(
      "BenchBox 0.1.5 (inferred from run date), result 5e453c54, https://benchbox.dev/results/r/tpch_sf1_doris_sql_20261007_172956_5e453c54, accessed 2026-11-18. Not an official TPC result.",
    );
  });
});
