import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "parse5";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { derivedTpcName } from "@/lib/subscale";
import { listResults, type ResultRow } from "@/lib/duckdbQueries";
import { closeResultsSnapshot, openResultsSnapshot } from "../src/lib/results-db.ts";
import { receiptPath, renderReceiptMain, renderReceiptPage } from "../src/lib/result-receipts.ts";
import { snapshotFile, fileSha256 } from "../src/lib/results-summary.ts";
import { builtSite } from "./built-site.ts";

interface Node5 {
  nodeName: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Node5[];
  value?: string;
}

const site = builtSite();

function text(node: Node5): string {
  return node.nodeName === "#text" ? (node.value ?? "") : (node.childNodes ?? []).map(text).join("");
}

function walk(node: Node5, visit: (candidate: Node5) => void): void {
  visit(node);
  for (const child of node.childNodes ?? []) walk(child, visit);
}

function summaryStructure(html: string): { mainRows: string[][]; headings: string[]; excludedHeadingBeforeTable: boolean; excludedRows: string[][] } {
  const mainRows: string[][] = [];
  const excludedRows: string[][] = [];
  const headings: string[] = [];
  let tables = 0;
  let excludedHeadingIndex = -1;
  let excludedTableIndex = -1;
  let order = 0;
  walk(parse(html) as unknown as Node5, (node) => {
    if (node.nodeName === "h2") {
      headings.push(text(node).trim());
      if (text(node).trim() === "Runs not included in rankings") excludedHeadingIndex = order;
    }
    if (node.nodeName === "table") {
      const inExcluded = excludedHeadingIndex >= 0 && excludedTableIndex < 0;
      if (inExcluded) excludedTableIndex = order;
      const target = inExcluded ? excludedRows : mainRows;
      walk(node, (row) => {
        if (row.nodeName === "tr" && (row.childNodes ?? []).some((cell) => cell.nodeName === "td")) {
          target.push((row.childNodes ?? []).filter((cell) => cell.nodeName === "td" || cell.nodeName === "th").map((cell) => text(cell).trim()));
        }
      });
      tables += 1;
    }
    order += 1;
  });
  return { mainRows, headings, excludedHeadingBeforeTable: excludedHeadingIndex < 0 || excludedHeadingIndex < excludedTableIndex, excludedRows: tables === 0 ? [] : excludedRows };
}

describe.skipIf(site === undefined)("built result permalink pages", () => {
  let rows: ResultRow[];

  beforeAll(async () => {
    await openResultsSnapshot(snapshotFile());
    rows = (await listResults()).filter((row) => row.visibility.startsWith("public-"));
  });

  afterAll(() => closeResultsSnapshot());

  it("has exactly one page per published result", () => {
    const files = readdirSync(path.join(site!, "results", "r")).filter((name) => name.endsWith(".html")).map((name) => name.replace(/\.html$/, "")).sort();
    expect(files).toEqual(rows.map((row) => row.result_id).sort());
    expect(rows.length).toBeGreaterThan(0);
  });

  it("states the id, every receipt field and the snapshot on each page, readable without JavaScript", () => {
    const sha = fileSha256(snapshotFile());
    for (const row of rows) {
      const html = readFileSync(path.join(site!, "results", "r", `${row.result_id}.html`), "utf-8");
      expect(html, row.result_id).toContain(row.result_id);
      expect(html, row.result_id).toContain('id="run-receipt"');
      expect(html, row.result_id).toContain(`rel="canonical" href="https://benchbox.dev/results/r/${row.result_id}"`);
      expect(html, row.result_id).toContain(`sha256:${sha}`);
      for (const label of ["Benchmark", "Platform", "Platform version", "Scale factor", "Phase", "Run date", "Geomean query time", "Ranking status", "Ranking reason", "Trust label", "Tuning mode", "Execution mode", "Bundle JSON"]) {
        expect(html, `${row.result_id} ${label}`).toContain(`<th scope="row">${label}</th>`);
      }
      expect(html, row.result_id).toContain("Cite as:");
      expect(html, row.result_id).toContain(row.bundle_download_url);
      expect(html, row.result_id).toContain('<script type="module"');
      const derived = derivedTpcName(row.benchmark);
      if (derived !== null) expect(html, row.result_id).toContain(`Derived from ${derived}.`);
    }
  });

  it("lists each permalink in the sitemap without the file extension", () => {
    const sitemap = readFileSync(path.join(site!, "sitemap.xml"), "utf-8");
    for (const row of rows) expect(sitemap).toContain(`<loc>https://benchbox.dev/results/r/${row.result_id}</loc>`);
  });

  it("points the Explorer index at the static summaries for readers without JavaScript", () => {
    const html = readFileSync(path.join(site!, "results", "index.html"), "utf-8");
    expect(html).toContain('href="/result-summaries/"');
    expect(html).toContain('href="/result-summaries/platforms.html"');
    expect(html).toContain('href="/result-summaries/benchmarks.html"');
  });

  it("keeps only Ranked runs in the main table of every summary page and states the reason before the excluded table", () => {
    let excludedPages = 0;
    for (const kind of ["platforms", "benchmarks"]) {
      const directory = path.join(site!, "result-summaries", kind);
      for (const name of readdirSync(directory)) {
        const structure = summaryStructure(readFileSync(path.join(directory, name), "utf-8"));
        const statusColumn = kind === "platforms" ? 7 : 6;
        for (const cells of structure.mainRows) expect(cells[statusColumn], `${kind}/${name}`).toBe("Ranked");
        for (const cells of structure.excludedRows) expect(cells.at(-1), `${kind}/${name}`).not.toBe("Ranked");
        expect(structure.excludedHeadingBeforeTable, `${kind}/${name}`).toBe(true);
        if (structure.excludedRows.length > 0) excludedPages += 1;
      }
    }
    expect(excludedPages > 0).toBe(rows.some((row) => row.ranking_exclusion_reason !== null));
  });

  it("serves no Explorer file from the permalink directory", () => {
    expect(existsSync(path.join(site!, "results", "r", "index.html"))).toBe(false);
  });
});

describe("result permalink pages", () => {
  it("refuses an id that cannot be a single path segment", () => {
    expect(() => receiptPath("../escape")).toThrow(/safe path segment/);
    expect(receiptPath("tpch-duckdb-sf1.0-20260901-6d73f241")).toBe("/results/r/tpch-duckdb-sf1.0-20260901-6d73f241");
  });

  it("escapes recorded text and fails when the Explorer template drifts", () => {
    const receipt = {
      resultId: "x-1",
      title: "<script>alert(1)</script>",
      description: 'a "quoted" <b>',
      headline: "h",
      rankingStatus: "Ranked",
      derivedNotice: null,
      sections: [{ title: "S", rows: [{ label: "L", value: "<img src=x onerror=alert(1)>" }] }],
      citeLine: "c",
      citationBlock: "b",
      summaryHrefs: [],
    };
    expect(renderReceiptMain(receipt)).not.toContain("<script>");
    expect(renderReceiptMain(receipt)).not.toContain("<img");
    expect(() => renderReceiptPage("<html></html>", receipt, "https://benchbox.dev")).toThrow(/Explorer index.html has no/);
  });
});
