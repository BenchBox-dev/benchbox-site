import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({
  queryRows: vi.fn(),
}));

import { queryRows } from "@/db";
import { loadCorpusLabels } from "@/lib/corpusLabelQueries";
import { CORPUS_LABEL_COLUMNS } from "@/lib/corpusLabels";
import { clearDuckdbQueryCachesForTests } from "@/lib/duckdbQueries";

const mockedQueryRows = vi.mocked(queryRows);

const COLUMN_ROWS = CORPUS_LABEL_COLUMNS.map((column_name) => ({ column_name }));

const LABELLED_ROW = {
  result_id: "r-1",
  corpus_class: "power_only",
  corpus_lanes: '["power_only"]',
  corpus_labels: '["Derived from TPC-H, not an official TPC result", "Power test only"]',
  row_count_evidence_label: "row counts not checked",
  iteration_label: "single iteration",
};

beforeEach(() => {
  mockedQueryRows.mockReset();
  clearDuckdbQueryCachesForTests();
});

describe("loadCorpusLabels", () => {
  it("reads nothing from a snapshot whose results table has no corpus columns", async () => {
    mockedQueryRows.mockResolvedValueOnce([]).mockResolvedValueOnce([{ read_model_version: 20 }]);
    expect((await loadCorpusLabels()).size).toBe(0);
    expect(mockedQueryRows).toHaveBeenCalledTimes(2);
    expect(String(mockedQueryRows.mock.calls[0]![0])).toContain("duckdb_columns()");
  });

  it("refuses a read-model 21 snapshot that has none of the columns", async () => {
    mockedQueryRows.mockResolvedValueOnce([]).mockResolvedValueOnce([{ read_model_version: 21 }]);
    await expect(loadCorpusLabels()).rejects.toThrow(/none of the corpus label columns/);
  });

  it("parses the labels of every result when the columns are present", async () => {
    mockedQueryRows.mockResolvedValueOnce(COLUMN_ROWS).mockResolvedValueOnce([LABELLED_ROW]);
    const labels = await loadCorpusLabels();
    expect(labels.get("r-1")?.corpusClass).toBe("power_only");
    expect(labels.get("r-1")?.iteration).toBe("single iteration");
    expect(String(mockedQueryRows.mock.calls[1]![0])).toContain("FROM bench.results");
  });

  it("refuses a snapshot that carries only some of the columns", async () => {
    mockedQueryRows.mockResolvedValueOnce(COLUMN_ROWS.slice(0, 2));
    await expect(loadCorpusLabels()).rejects.toThrow(/only part of the corpus label columns/);
  });

  it("refuses a row the contract forbids", async () => {
    mockedQueryRows.mockResolvedValueOnce(COLUMN_ROWS).mockResolvedValueOnce([{ ...LABELLED_ROW, corpus_class: "official" }]);
    await expect(loadCorpusLabels()).rejects.toThrow(/corpus_class/);
  });
});
