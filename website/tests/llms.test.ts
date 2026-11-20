import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildSite, type BuildResult } from "../src/converter/build.ts";
import { checkPublishedLlms, FEATURED_SECTIONS, linksIn } from "../src/lib/llms.ts";
import { siteOrigin } from "../src/lib/site-origin.ts";
import { builtSite } from "./built-site.ts";
import { cleanup, writeDocs } from "./support.ts";

const ORIGIN = "https://site.test";
const websiteRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const scratch: string[] = [];

afterEach(() => {
  cleanup();
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const featuredPages = FEATURED_SECTIONS.flatMap((section) => section.pages);

function docsTree(extra: Record<string, string> = {}, nav = "- usage/installation.md"): Record<string, string> {
  const featured = Object.fromEntries(featuredPages.map((page) => [page, `# ${page}\n\nBody of ${page}.\n`]));
  return {
    "index.md": "# Home\n\nBenchBox benchmarks databases.\n\nSecond paragraph.\n",
    ...featured,
    ...extra,
    "nav.yml": `groups:\n  - label: Start\n    items:\n      ${nav}\n`,
  };
}

function convert(files: Record<string, string>): BuildResult {
  const result = buildSite({ docsRoot: writeDocs(files), origin: ORIGIN });
  expect(result.errors.map((error) => error.message)).toEqual([]);
  return result;
}

function markdownOf(result: BuildResult, page: string): string {
  const markdown = result.files.get(`markdown/docs/${page}.md`);
  if (markdown === undefined) throw new Error(`no Markdown for ${page}`);
  return markdown;
}

describe("Markdown pages", () => {
  it("emits one Markdown file beside each documentation page and none for the blog", () => {
    const result = convert(docsTree({ "guides/a.md": "# A\n", "blog/post.md": "---\ndate: 2026-01-01\n---\n\n# Post\n" }));
    const emitted = [...result.files.keys()].filter((key) => key.startsWith("markdown/")).sort();
    expect(emitted).toContain("markdown/docs/guides/a.md");
    expect(emitted).toContain("markdown/docs/index.md");
    expect(emitted.some((key) => key.includes("blog"))).toBe(false);
    expect(emitted.length).toBe([...result.files.keys()].filter((key) => key.startsWith("content/docs/")).length);
  });

  it("rewrites page links to absolute Markdown URLs, keeps fragments and makes other site paths absolute", () => {
    const result = convert(
      docsTree({
        "guides/a.md": "# A\n\n## Section\n\nSee [B](b.md#target-heading), [home](../index.md), [up](#section), [web](https://example.com/x).\n",
        "guides/b.md": "# B\n\n## Target heading\n",
        "README.md": "# Readme\n",
      }),
    );
    const markdown = markdownOf(result, "guides/a");
    expect(markdown).toContain(`[B](${ORIGIN}/docs/guides/b.md#target-heading)`);
    expect(markdown).toContain(`[home](${ORIGIN}/docs/index.md)`);
    expect(markdown).toContain("[up](#section)");
    expect(markdown).toContain("[web](https://example.com/x)");
    expect(markdown).not.toMatch(/\]\((?!https?:|#)/);
  });

  it("starts with the title, drops anchor spans, and turns components back into plain Markdown", () => {
    const result = convert(
      docsTree({
        "guides/a.md": [
          "# The Title",
          "",
          '<span id="old-anchor"></span>',
          "",
          "> [!WARNING]",
          "> Mind the gap.",
          "",
          "```mermaid",
          "graph TD; A-->B",
          "```",
          "",
          "```benchbox-result",
          "kind: current",
          "results:",
          "  - tpch-duckdb-sf1.0-20261007-83a01707",
          "```",
          "",
          "| a | b |",
          "| - | - |",
          "| 1 | 2 |",
          "",
        ].join("\n"),
      }),
    );
    const markdown = markdownOf(result, "guides/a");
    expect(markdown.startsWith("# The Title\n")).toBe(true);
    expect(markdown).not.toContain("<span id");
    expect(markdown).not.toContain("<Callout");
    expect(markdown).not.toContain("<Mermaid");
    expect(markdown).toContain("> [!WARNING]\n>\n> Mind the gap.");
    expect(markdown).toContain("```mermaid\ngraph TD; A-->B\n```");
    expect(markdown).toContain("| a | b |");
    expect(markdown).toContain(`(${ORIGIN}/docs/guides/a.html)`);
  });
});

describe("llms.txt", () => {
  it("lists the featured pages, every nav page and the summary from the docs landing page", () => {
    const result = convert(docsTree({ "guides/a.md": "# A\n", "guides/b.md": "# B\n" }, "- guides/a.md\n      - guides/b.md"));
    const llms = result.files.get("manifest/llms.txt") as string;
    expect(llms.startsWith("# BenchBox\n\n> BenchBox benchmarks databases.\n")).toBe(true);
    for (const page of featuredPages) expect(llms).toContain(`(${ORIGIN}/docs/${page})`);
    expect(llms).toContain(`(${ORIGIN}/docs/guides/a.md)`);
    expect(llms).toContain(`(${ORIGIN}/docs/guides/b.md)`);
    expect(llms).toContain(`(${ORIGIN}/result-summaries/)`);
    expect(llms).not.toContain("Second paragraph");
  });

  it("lists a page that nav.yml omits under Optional instead of dropping it", () => {
    const result = convert(docsTree({ "guides/orphan.md": "# Orphan\n", "guides/listed.md": "# Listed\n" }, "- guides/listed.md"));
    const llms = result.files.get("manifest/llms.txt") as string;
    const optional = llms.slice(llms.indexOf("## Optional"));
    expect(optional).toContain(`[Orphan](${ORIGIN}/docs/guides/orphan.md)`);
    expect(optional).not.toContain("guides/listed.md");
  });

  it("collapses generated pages that a listed index links to and lists unreachable ones", () => {
    const result = convert(
      docsTree({
        "benchmarks/queries/index.md": "# Queries\n\n- [Q1](x/q1.md)\n",
        "benchmarks/queries/x/q1.md": "# Q1\n",
        "benchmarks/queries/x/stray.md": "# Stray\n",
      }, "- benchmarks/queries/index.md"),
    );
    const llms = result.files.get("manifest/llms.txt") as string;
    expect(llms).toContain("benchmarks/queries/index.md");
    expect(llms).not.toContain("x/q1.md");
    expect(llms).toContain(`[Stray](${ORIGIN}/docs/benchmarks/queries/x/stray.md)`);
  });

  it("fails the conversion when a featured page is missing", () => {
    const files = docsTree();
    delete files["concepts/benchmark-methodology.md"];
    const result = buildSite({ docsRoot: writeDocs(files), origin: ORIGIN });
    expect(result.errors.map((error) => error.message).join("\n")).toContain("concepts/benchmark-methodology.md is not a documentation page");
  });

  it("emits neither Markdown nor llms.txt unless the converter is given an origin", () => {
    const result = buildSite({ docsRoot: writeDocs(docsTree()) });
    expect([...result.files.keys()].some((key) => key.startsWith("markdown/") || key === "manifest/llms.txt")).toBe(false);
  });
});

function distWith(files: Record<string, string>): string {
  const dist = mkdtempSync(path.join(os.tmpdir(), "benchbox-llms-dist-"));
  scratch.push(dist);
  for (const [relative, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dist, relative)), { recursive: true });
    writeFileSync(path.join(dist, relative), content);
  }
  return dist;
}

const goodSite = {
  "llms.txt": `# BenchBox\n\n## Docs\n\n- [Install](${ORIGIN}/docs/install.md)\n- [Summaries](${ORIGIN}/result-summaries/)\n- [Benchmarks](${ORIGIN}/result-summaries/benchmarks)\n`,
  "docs/install.md": `# Install\n\nSee [next](${ORIGIN}/docs/next.md#part) and [web](https://example.com/missing).\n`,
  "docs/next.md": "# Next\n",
  "result-summaries/index.html": "<html></html>",
  "result-summaries/benchmarks.html": "<html></html>",
};

describe("llms.txt link check", () => {
  it("passes when every link resolves to an emitted file", () => {
    expect(checkPublishedLlms(distWith(goodSite), ORIGIN)).toEqual([]);
  });

  it("fails on a dead link in llms.txt", () => {
    const dist = distWith({ ...goodSite, "llms.txt": `${goodSite["llms.txt"]}- [Gone](${ORIGIN}/docs/gone.md)\n` });
    expect(checkPublishedLlms(dist, ORIGIN)).toEqual([`llms.txt: ${ORIGIN}/docs/gone.md does not resolve to a file in the built site`]);
  });

  it("fails on a Markdown link that has no .md file, even though the HTML page exists", () => {
    const dist = distWith({ ...goodSite, "docs/gone.html": "<html></html>", "llms.txt": `${goodSite["llms.txt"]}- [Gone](${ORIGIN}/docs/gone.md)\n` });
    expect(checkPublishedLlms(dist, ORIGIN)).toHaveLength(1);
  });

  it("fails on a dead link inside a Markdown page", () => {
    const dist = distWith({ ...goodSite, "docs/install.md": `# Install\n\n[Gone](${ORIGIN}/docs/gone.md)\n` });
    expect(checkPublishedLlms(dist, ORIGIN)).toEqual([`docs/install.md: ${ORIGIN}/docs/gone.md does not resolve to a file in the built site`]);
  });

  it("fails when llms.txt links off the site, is missing, or links to nothing", () => {
    expect(checkPublishedLlms(distWith({ ...goodSite, "llms.txt": `# BenchBox\n\n- [Out](https://example.com/a)\n` }), ORIGIN).join("\n")).toContain("is not on https://site.test");
    const { "llms.txt": _removed, ...withoutLlms } = goodSite;
    expect(checkPublishedLlms(distWith(withoutLlms), ORIGIN)).toEqual(["llms.txt is missing from the built site"]);
    expect(checkPublishedLlms(distWith({ ...goodSite, "llms.txt": "# BenchBox\n" }), ORIGIN)).toEqual(["llms.txt links to nothing"]);
  });

  it("resolves directory and extensionless URLs the way Pages serves them", () => {
    const dist = distWith({ ...goodSite, "llms.txt": `# B\n\n- [a](${ORIGIN}/docs/)\n- [b](${ORIGIN}/docs/page)\n`, "docs/index.html": "", "docs/page.html": "" });
    expect(checkPublishedLlms(dist, ORIGIN)).toEqual([]);
  });
});

const built = builtSite();

describe("built site", () => {
  it.skipIf(!built)("serves llms.txt whose every link resolves, with a Markdown file for every converted page", () => {
    expect(checkPublishedLlms(built!, siteOrigin())).toEqual([]);
    const llms = readFileSync(path.join(built!, "llms.txt"), "utf-8");
    expect(linksIn(llms).length).toBeGreaterThan(100);
    const generated = path.join(websiteRoot, ".generated", "content", "docs");
    const pages = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? pages(path.join(directory, entry.name)) : [path.join(directory, entry.name)]));
    for (const file of pages(generated)) {
      const relative = path.relative(generated, file).replace(/\.mdx?$/, "");
      expect(existsSync(path.join(built!, "docs", `${relative}.md`)), relative).toBe(true);
    }
  });

  it.skipIf(!built)("names the installation, CLI, MCP, methodology and result summary pages", () => {
    const llms = readFileSync(path.join(built!, "llms.txt"), "utf-8");
    for (const page of ["usage/installation", "usage/getting-started", "reference/cli/index", "reference/mcp", "concepts/benchmark-methodology"]) {
      expect(llms).toContain(`/docs/${page}.md)`);
    }
    expect(llms).toContain("/result-summaries/)");
  });
});
