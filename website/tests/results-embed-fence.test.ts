import { afterEach, describe, expect, it } from "vitest";
import { formatCitationBlock, parseEmbedBlock, type Citation } from "../src/lib/results-embed.ts";
import { build, cleanup, pageOf } from "./support.ts";

afterEach(cleanup);

const CITATION: Citation = {
  result: "tpch-duckdb-sf1.0-20260826-d4fa245c",
  snapshot: "0e189624e6712c0e96cac56022b6530ec99648e2a1ffa0aade638652490822ea",
  snapshotDate: "2026-11-06",
  platform: "DuckDB",
  benchmark: "TPC-H",
  scale: "SF 1",
  runDate: "2026-08-26",
  metric: "Geomean query time",
  direction: "lower is better",
  value: "5.66 ms",
};

const CURRENT = "```benchbox-result\nkind: current\nresults:\n  - tpch-duckdb-sf1.0-20260826-d4fa245c\n  - tpch-polars-sf1.0-20260824-df3e2295\n```\n";

describe("benchbox-result fences", () => {
  it("convert a cited block into a lazily hydrated CitedResult island that carries the citation", () => {
    const result = build({ "a.md": `# A\n\nIntro.\n\n${formatCitationBlock(CITATION)}` });
    expect(result.errors).toEqual([]);
    const page = pageOf(result, "docs/a.mdx");
    expect(page).toContain('import CitedResult from "../../../src/components/results/CitedResult.tsx";');
    expect(page).toContain("client:visible");
    const citation = /citation=\{(.*)\}/.exec(page);
    expect(JSON.parse(citation![1]!)).toEqual(CITATION);
  });

  it("convert a current block into a CurrentResults island listing the result ids in order", () => {
    const result = build({ "a.md": `# A\n\n${CURRENT}` });
    expect(result.errors).toEqual([]);
    const page = pageOf(result, "docs/a.mdx");
    expect(page).toContain('import CurrentResults from "../../../src/components/results/CurrentResults.tsx";');
    expect(JSON.parse(/results=\{(.*)\}/.exec(page)![1]!)).toEqual(["tpch-duckdb-sf1.0-20260826-d4fa245c", "tpch-polars-sf1.0-20260824-df3e2295"]);
  });

  it("leave an ordinary yaml fence alone, as a plain page", () => {
    const result = build({ "a.md": "# A\n\n```yaml\nkind: cited\n```\n" });
    expect(pageOf(result, "docs/a.md")).toContain("```yaml\nkind: cited\n```");
  });

  it("fail the build with the file and line for a block that cannot be shown", () => {
    const result = build({ "a.md": "# A\n\ntext\n\n```benchbox-result\nkind: cited\nresult: tpch-duckdb-sf1.0-20260826-d4fa245c\n```\n" });
    expect(result.errors.map((error) => error.message)).toEqual(["a.md:5: a cited benchbox-result block needs snapshot"]);
  });
});

describe("block validation", () => {
  it("round-trips a citation through the form the cite command prints", () => {
    expect(parseEmbedBlock(formatCitationBlock(CITATION).replace(/^```.*\n|```\n$/g, ""))).toEqual({ kind: "cited", citation: CITATION });
  });

  it.each([
    ["an unknown key", "kind: current\nresults: [tpch-duckdb-sf1.0-20260826-d4fa245c]\nlive: true", "no key live"],
    ["an empty result list", "kind: current\nresults: []", "needs results"],
    ["a repeated result", "kind: current\nresults: [abc-123, abc-123]", "twice"],
    ["a result id that is not an id", "kind: current\nresults: ['x y']", "is not a result id"],
    ["more results than the table allows", `kind: current\nresults: [${Array.from({ length: 11 }, (_, i) => `abc-${i}`).join(", ")}]`, "at most 10"],
    ["a kind that does not exist", "kind: live", "kind: cited or kind: current"],
    ["a block that is not a mapping", "- a\n- b", "list of"],
    ["a truncated snapshot digest", formatCitationBlock({ ...CITATION, snapshot: "0e189624" }).replace(/^```.*\n|```\n$/g, ""), "64 hex"],
    ["a date in another format", formatCitationBlock({ ...CITATION, runDate: "26 Aug 2026" }).replace(/^```.*\n|```\n$/g, ""), "YYYY-MM-DD"],
    ["a direction the Explorer never uses", formatCitationBlock({ ...CITATION, direction: "bigger" }).replace(/^```.*\n|```\n$/g, ""), "direction must be"],
  ])("rejects %s", (_name, body, message) => {
    expect(() => parseEmbedBlock(body)).toThrow(message);
  });
});
