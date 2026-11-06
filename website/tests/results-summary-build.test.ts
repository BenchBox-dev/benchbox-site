import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import * as pagefind from "pagefind";
import { parse } from "parse5";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBenchmarkRanking, listResults } from "@/lib/duckdbQueries";
import { indexSite, SEARCH_SECTIONS } from "../scripts/pagefind-index.mjs";
import { closeResultsSnapshot, openResultsSnapshot } from "../src/lib/results-db.ts";
import { buildResultsSummary, fileSha256, snapshotFile, type ResultsSummary } from "../src/lib/results-summary.ts";
import { bundleManifest } from "../src/lib/site-inputs.ts";
import { builtSite } from "./built-site.ts";

interface Node5 {
  nodeName: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Node5[];
  value?: string;
}

const site = builtSite();
const attr = (node: Node5, name: string) => node.attrs?.find((entry) => entry.name === name)?.value;

function text(node: Node5): string {
  return node.nodeName === "#text" ? (node.value ?? "") : (node.childNodes ?? []).map(text).join("");
}

function find(node: Node5, test: (candidate: Node5) => boolean, found: Node5[] = []): Node5[] {
  if (test(node)) found.push(node);
  for (const child of node.childNodes ?? []) find(child, test, found);
  return found;
}

function tableRows(html: string): { receipt: string | undefined; cells: string[] }[] {
  const document = parse(html) as unknown as Node5;
  return find(document, (node) => node.nodeName === "tr").map((row) => ({
    receipt: find(row, (node) => node.nodeName === "a").map((anchor) => attr(anchor, "href"))[0],
    cells: (row.childNodes ?? []).filter((cell) => cell.nodeName === "td" || cell.nodeName === "th").map((cell) => text(cell).trim()),
  }));
}

function pageIds(dir: string): string[] {
  return readdirSync(path.join(site!, "result-summaries", dir)).map((name) => name.replace(/\.html$/, "")).sort();
}

interface Fragment {
  url: string;
  filters: Record<string, string[]>;
  meta: { title?: string };
  content: string;
}

describe.skipIf(site === undefined)("built result summary pages", () => {
  let summary: ResultsSummary;

  beforeAll(async () => {
    await openResultsSnapshot(snapshotFile());
    const manifest = bundleManifest();
    summary = await buildResultsSummary(await listResults(), getBenchmarkRanking, {
      coreSha: manifest.core_sha,
      corpusSha: manifest.corpus_sha,
      packageVersion: manifest.package_version,
      producedAt: manifest.produced_at ?? null,
      snapshotSha256: fileSha256(snapshotFile()),
      readModelVersion: 18,
    });
  });

  afterAll(() => closeResultsSnapshot());

  it("has one page per published platform and benchmark and no others", () => {
    expect(pageIds("platforms")).toEqual(summary.platforms.map((page) => page.id).sort());
    expect(pageIds("benchmarks")).toEqual(summary.benchmarks.map((page) => page.id).sort());
  });

  it("lists every summary page in the sitemap", () => {
    const sitemap = readFileSync(path.join(site!, "sitemap.xml"), "utf-8");
    const expected = [...summary.platforms, ...summary.benchmarks].map((page) => page.summaryHref);
    for (const href of [...expected, "/result-summaries/index.html", "/result-summaries/platforms.html", "/result-summaries/benchmarks.html"]) {
      expect(sitemap, href).toContain(`${href}</loc>`);
    }
  });

  it("states the snapshot identity and links into the matching Explorer view", () => {
    const platform = summary.platforms[0]!;
    const html = readFileSync(path.join(site!, "result-summaries", "platforms", `${platform.id}.html`), "utf-8");
    expect(html).toContain(summary.snapshot.snapshotSha256.slice(0, 12));
    expect(html).toContain(summary.snapshot.coreSha.slice(0, 12));
    expect(html).toContain(`href="/results/p/${platform.id}/"`);
    const benchmark = summary.benchmarks[0]!;
    const benchmarkHtml = readFileSync(path.join(site!, "result-summaries", "benchmarks", `${benchmark.id}.html`), "utf-8");
    expect(benchmarkHtml).toContain(`href="/results/${benchmark.id}/"`);
  });

  it("renders the Explorer's values for every run of a platform", () => {
    const platform = summary.platforms.find((page) => page.id === "duckdb") ?? summary.platforms[0]!;
    const rows = tableRows(readFileSync(path.join(site!, "result-summaries", "platforms", `${platform.id}.html`), "utf-8"));
    for (const run of platform.runs) {
      const row = rows.find((candidate) => candidate.receipt === run.receiptHref);
      expect(row?.cells, run.resultId).toEqual([run.benchmarkLabel, run.scale, run.phase, run.version ?? "—", run.runDate.slice(0, 10), run.score, run.geomean, run.rankingStatus]);
    }
  });

  it("renders each ranking line of a benchmark in the Explorer's order", () => {
    const benchmark = summary.benchmarks.find((page) => page.id === "tpch") ?? summary.benchmarks[0]!;
    const rows = tableRows(readFileSync(path.join(site!, "result-summaries", "benchmarks", `${benchmark.id}.html`), "utf-8"));
    const rendered = rows.filter((row) => row.receipt !== undefined && row.cells.length === 7).map((row) => row.receipt);
    expect(rendered).toEqual(benchmark.cohorts.flatMap((cohort) => cohort.ranking.map((line) => line.receiptHref)));
  });
});

describe.skipIf(site === undefined)("search index for the built summary pages", () => {
  const resultsSections = SEARCH_SECTIONS.filter((section) => section.name === "Results");
  let fragments: Fragment[];

  beforeAll(async () => {
    const { index } = await indexSite(site!, resultsSections);
    const { files } = await index.getFiles();
    fragments = files
      .filter((file: { path: string }) => file.path.endsWith(".pf_fragment"))
      .map((file: { content: Uint8Array }) => JSON.parse(gunzipSync(Buffer.from(file.content)).toString("utf8").replace(/^pagefind_dcd/, "")) as Fragment);
    await pagefind.close();
  });

  it("holds each platform and benchmark page, titled by name, in the Results section", () => {
    const expected = [...pageUrls("platforms"), ...pageUrls("benchmarks")].sort();
    expect(fragments.map((fragment) => fragment.url).sort()).toEqual(expected);
    for (const fragment of fragments) {
      expect(fragment.filters).toEqual({ section: ["Results"] });
      expect(fragment.meta.title).toBeTruthy();
    }
    expect(fragments.some((fragment) => fragment.url === "/result-summaries/platforms/duckdb.html" && fragment.meta.title === "DuckDB")).toBe(true);
    expect(fragments.some((fragment) => fragment.url === "/result-summaries/benchmarks/tpch.html" && fragment.meta.title === "TPC-H")).toBe(true);
  });

  it("leaves the entry and index pages out of search", () => {
    expect(fragments.some((fragment) => /\/result-summaries\/(index|platforms|benchmarks)\.html$/.test(fragment.url))).toBe(false);
  });
});

function pageUrls(dir: string): string[] {
  const root = path.join(site!, "result-summaries", dir);
  return existsSync(root) ? readdirSync(root).map((name) => `/result-summaries/${dir}/${name}`) : [];
}
