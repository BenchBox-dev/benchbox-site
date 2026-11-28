import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CORPUS_CLASSES,
  CORPUS_LABEL_COLUMNS,
  CORPUS_LANES,
  CorpusLabelError,
  corpusLabelTexts,
  parseCorpusLabels,
} from "@/lib/corpusLabels";

const FIXTURE_DIR = resolve(process.cwd(), "test-fixtures", "next-read-model");

interface FixtureColumn {
  name: string;
  allowed_values?: string[];
}

interface Contract {
  read_model_version: number;
  tables: { results: { added_columns: FixtureColumn[] } };
  rows: { results: Record<string, unknown>[] };
}

const contract = JSON.parse(readFileSync(resolve(FIXTURE_DIR, "next_read_model_contract.json"), "utf8")) as Contract;

function exampleRow(resultId: string): Record<string, unknown> {
  const row = contract.rows.results.find((candidate) => candidate.result_id === resultId);
  if (!row) throw new Error(`the contract fixture has no row ${resultId}`);
  return row;
}

describe("next read-model contract fixture", () => {
  it("is the version this site accepts as its newest", () => {
    expect(contract.read_model_version).toBe(21);
  });

  it("is the copy its provenance hashes, with the amendment it names", () => {
    const provenance = JSON.parse(readFileSync(resolve(FIXTURE_DIR, "provenance.json"), "utf8")) as { sha256: string; core_commit: string };
    expect(createHash("sha256").update(readFileSync(resolve(FIXTURE_DIR, "next_read_model_contract.json"))).digest("hex")).toBe(
      provenance.sha256,
    );
    expect(provenance.core_commit).toMatch(/^[0-9a-f]{10,40}$/);
  });

  it("keeps tuned and untuned medians apart", () => {
    const tables = (JSON.parse(readFileSync(resolve(FIXTURE_DIR, "next_read_model_contract.json"), "utf8")) as {
      tables: Record<string, { primary_key?: string[]; columns?: FixtureColumn[]; added_columns?: FixtureColumn[] }>;
      rows: { identity_medians: Record<string, unknown>[] };
    });
    const medians = tables.tables.identity_medians!;
    expect(medians.primary_key).toEqual(["cohort_key", "lane", "variant_id", "tuning_mode", "comparison_version"]);
    const definition = (columns: FixtureColumn[] | undefined) => columns?.find((column) => column.name === "tuning_mode");
    expect(definition(medians.columns)).toMatchObject({ type: "VARCHAR", nullable: false });
    expect(definition(tables.tables.benchmark_rankings!.added_columns)).toMatchObject({ type: "VARCHAR", nullable: false });
    const keys = tables.rows.identity_medians.map((row) => [row.cohort_key, row.lane, row.variant_id, row.tuning_mode, row.comparison_version].join("|"));
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(tables.rows.identity_medians.map((row) => row.tuning_mode))).toEqual(new Set(["notuning", "tuned"]));
  });

  it("adds every column the site reads", () => {
    const added = contract.tables.results.added_columns.map((column) => column.name);
    for (const column of CORPUS_LABEL_COLUMNS) expect(added).toContain(column);
  });

  it("allows exactly the classes and lanes the site validates", () => {
    const byName = new Map(contract.tables.results.added_columns.map((column) => [column.name, column]));
    expect([...CORPUS_CLASSES].sort()).toEqual([...(byName.get("corpus_class")!.allowed_values ?? [])].sort());
    expect([...CORPUS_LANES].sort()).toEqual([...(byName.get("corpus_lanes")!.allowed_values ?? [])].sort());
  });

  it("parses every example row", () => {
    for (const row of contract.rows.results) expect(() => parseCorpusLabels(row)).not.toThrow();
  });
});

describe("corpusLabelTexts", () => {
  it("lists the derived wording, the class in words, the row-count label and the iteration label in order", () => {
    expect(corpusLabelTexts(parseCorpusLabels(exampleRow("example-pre-release")))).toEqual([
      "Derived from TPC-H, not an official TPC result",
      "Power test only",
      "Row counts not checked",
      "Single iteration",
    ]);
  });

  it("leaves out the labels a result does not carry", () => {
    expect(corpusLabelTexts(parseCorpusLabels(exampleRow("example-ranked-release")))).toEqual([
      "Derived from TPC-H, not an official TPC result",
      "Power test only",
    ]);
    expect(corpusLabelTexts(parseCorpusLabels(exampleRow("example-version-not-recorded")))).toEqual([
      "Derived from TPC-DS, not an official TPC result",
      "Partial run: not every required phase ran",
      "Row counts not checked",
    ]);
  });

  it("returns nothing for a result without labels", () => {
    expect(corpusLabelTexts(undefined)).toEqual([]);
  });

  it("does not repeat a sentence the rule already wrote", () => {
    const row = { ...exampleRow("example-pre-release"), corpus_labels: JSON.stringify(["Row counts not checked"]) };
    expect(corpusLabelTexts(parseCorpusLabels(row)).filter((text) => text === "Row counts not checked")).toHaveLength(1);
  });
});

describe("parseCorpusLabels refuses what the contract forbids", () => {
  const valid = exampleRow("example-pre-release");

  it.each([
    ["an unknown class", { corpus_class: "official" }],
    ["a missing class", { corpus_class: null }],
    ["an unknown lane", { corpus_lanes: '["everything"]' }],
    ["lanes that are not JSON", { corpus_lanes: "power_only" }],
    ["lanes that are not an array", { corpus_lanes: '{"a":1}' }],
    ["labels that are not an array", { corpus_labels: '"Power test only"' }],
    ["an empty label sentence", { corpus_labels: '[""]' }],
    ["a non-text label sentence", { corpus_labels: "[1]" }],
    ["a blank row-count label", { row_count_evidence_label: " " }],
    ["a blank iteration label", { iteration_label: "" }],
  ])("%s", (_, override) => {
    expect(() => parseCorpusLabels({ ...valid, ...override })).toThrow(CorpusLabelError);
  });
});
