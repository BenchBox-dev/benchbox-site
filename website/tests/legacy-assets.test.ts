import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildSite } from "../src/converter/build.ts";
import {
  downloadUrlPath,
  imageUrlPath,
  legacyRedirects,
  loadLegacyDownloads,
  publishLegacyImages,
  publishLegacyRedirects,
  REDIRECT_PAGES,
  repositoryBlobUrl,
  renderObjectsInventory,
  renderRedirectPage,
  type LegacyDownloads,
  type LegacyRedirect,
} from "../src/lib/legacy-assets.ts";
import { fileURLToPath } from "node:url";
import { builtSite } from "./built-site.ts";
import { writeDocs } from "./support.ts";

const dist = builtSite();
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const built = dist === undefined ? describe.skip : describe;

describe("legacy public file paths", () => {
  it("reproduces the Sphinx download path from the source-relative file path", () => {
    const digest = createHash("md5").update("../examples/getting_started/run.py").digest("hex");
    expect(downloadUrlPath("../examples/getting_started/run.py")).toBe(`/docs/_downloads/${digest}/run.py`);
    expect(imageUrlPath("chart.png")).toBe("/docs/_images/chart.png");
  });

  it("copies each blog image to its legacy path and fails on a missing source", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "benchbox-legacy-"));
    try {
      mkdirSync(path.join(root, "docs", "blog", "images"), { recursive: true });
      writeFileSync(path.join(root, "docs", "blog", "images", "chart.png"), "png");
      const out = path.join(root, "out");
      expect(publishLegacyImages({ images: ["chart.png"] }, path.join(root, "docs"), out)).toBe(1);
      expect(readFileSync(path.join(out, "docs", "_images", "chart.png"), "utf-8")).toBe("png");
      expect(() => publishLegacyImages({ images: ["gone.png"] }, path.join(root, "docs"), out)).toThrow("missing");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const ARCHIVE = "a".repeat(40);
const OLDER = "b".repeat(40);
const TPCH_SOURCE = "../benchbox/_binaries/tpc-h/templates/queries/1.sql";
const TPCDS_SOURCE = "../_sources/tpc-ds/query_templates/query1.tpl";
const synthetic: LegacyDownloads = {
  core_sha: ARCHIVE,
  downloads: [
    { source: "../examples/run.py", path: "examples/run.py" },
    { source: "../benchbox/gone.py", path: "benchbox/gone.py", core_sha: OLDER },
    { source: TPCH_SOURCE, path: "benchbox/_binaries/tpc-h/templates/queries/1.sql", notice: "benchbox/_binaries/tpc-h/templates/queries/EULA.txt" },
    { source: TPCDS_SOURCE, path: "_sources/tpc-ds/query_templates/query1.tpl", notice: "_sources/tpc-ds/query_templates/EULA.txt" },
  ],
};
const blob = (sha: string, file: string) => `https://github.com/BenchBox-dev/BenchBox/blob/${sha}/${file}`;

describe("legacy download redirects", () => {
  const redirects = legacyRedirects(synthetic);
  const find = (url: string) => redirects.find((redirect) => redirect.url === url);

  it("points each legacy download at its path pinned to the archive commit", () => {
    expect(find(downloadUrlPath("../examples/run.py"))).toEqual({ url: downloadUrlPath("../examples/run.py"), target: blob(ARCHIVE, "examples/run.py") });
    expect(find(downloadUrlPath("../benchbox/gone.py"))?.target).toBe(blob(OLDER, "benchbox/gone.py"));
  });

  it("links the adjacent TPC notice from each template and adds a sidecar redirect to it", () => {
    const tpch = find(downloadUrlPath(TPCH_SOURCE));
    const tpcds = find(downloadUrlPath(TPCDS_SOURCE));
    expect(tpch?.notice).toBe(blob(ARCHIVE, "benchbox/_binaries/tpc-h/templates/queries/EULA.txt"));
    expect(tpcds?.notice).toBe(blob(ARCHIVE, "_sources/tpc-ds/query_templates/EULA.txt"));
    for (const [source, redirect] of [[TPCH_SOURCE, tpch], [TPCDS_SOURCE, tpcds]] as const) {
      const sidecar = find(`${path.posix.dirname(downloadUrlPath(source))}/TPC_EULA.txt`);
      expect(sidecar).toEqual({ url: `${path.posix.dirname(downloadUrlPath(source))}/TPC_EULA.txt`, target: redirect?.notice });
    }
    expect(redirects.filter((redirect) => redirect.url.endsWith("/TPC_EULA.txt"))).toHaveLength(2);
    expect(find(downloadUrlPath("../examples/run.py"))?.notice).toBeUndefined();
  });

  it("shows the notice link on a template redirect page and omits it elsewhere", () => {
    const tpch = find(downloadUrlPath(TPCH_SOURCE));
    const page = renderRedirectPage(tpch as LegacyRedirect);
    expect(page).toContain(`<meta http-equiv="refresh" content="5; url=${tpch?.target}">`);
    expect(page).toContain(`<a href="${tpch?.notice}">TPC End User License Agreement</a>`);
    const plain = find(downloadUrlPath("../examples/run.py")) as LegacyRedirect;
    expect(renderRedirectPage(plain)).not.toContain("TPC");
    expect(renderRedirectPage(plain)).toContain(`<meta http-equiv="refresh" content="0; url=${plain.target}">`);
    const sidecar = redirects.find((redirect) => redirect.url.endsWith("/TPC_EULA.txt")) as LegacyRedirect;
    expect(renderRedirectPage(sidecar)).toContain(`content="0; url=${sidecar.target}">`);
  });

  it("escapes markup in a target", () => {
    expect(renderRedirectPage({ target: 'https://example.test/a?b=1&c="2"' })).toContain('url=https://example.test/a?b=1&amp;c=&quot;2&quot;">');
  });

  it("writes each redirect as a directory index and no file under the legacy name", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "benchbox-redirects-"));
    try {
      expect(publishLegacyRedirects(redirects, root)).toBe(redirects.length);
      for (const redirect of redirects) {
        const written = path.join(root, redirect.url);
        expect(statSync(written).isDirectory()).toBe(true);
        expect(readdirSync(written)).toEqual(["index.html"]);
        expect(readFileSync(path.join(written, "index.html"), "utf-8")).toBe(renderRedirectPage(redirect));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("legacy download inventory", () => {
  const inventory = loadLegacyDownloads(path.join(repoRoot, "inventory", "legacy-downloads.json"));
  const redirects = legacyRedirects(inventory);
  const sha = /^[0-9a-f]{40}$/;

  it("pins every target to a full commit and keeps each legacy URL once", () => {
    expect(inventory.core_sha).toMatch(sha);
    const urls = inventory.downloads.map((download) => downloadUrlPath(download.source));
    expect(new Set(urls).size).toBe(urls.length);
    for (const download of inventory.downloads) {
      expect(download.source).toBe(`../${download.path}`);
      for (const segment of download.path.split("/")) expect(encodeURIComponent(segment)).toBe(segment);
      if (download.core_sha !== undefined) expect(download.core_sha).toMatch(sha);
    }
    for (const redirect of redirects) expect(redirect.target).toMatch(/^https:\/\/github\.com\/BenchBox-dev\/BenchBox\/blob\/[0-9a-f]{40}\/[^?#\s]+$/);
  });

  it("redirects every legacy download URL to its pinned core file", () => {
    const byUrl = new Map(redirects.map((redirect) => [redirect.url, redirect]));
    expect(inventory.downloads.length).toBeGreaterThan(0);
    for (const download of inventory.downloads) {
      const redirect = byUrl.get(downloadUrlPath(download.source));
      expect(redirect?.url).toMatch(/^\/docs\/_downloads\/[0-9a-f]{32}\/[^/]+$/);
      expect(redirect?.target).toBe(repositoryBlobUrl(download.core_sha ?? inventory.core_sha, download.path));
    }
  });

  it("gives a notice to every TPC query template and to nothing else", () => {
    const templates = [/^\.\.\/_sources\/tpc-ds\/query_templates\//, /^\.\.\/benchbox\/_binaries\/tpc-h\/templates\/queries\//];
    for (const download of inventory.downloads) {
      const isTemplate = templates.some((pattern) => pattern.test(download.source));
      expect(download.notice).toBe(isTemplate ? `${path.posix.dirname(download.path)}/EULA.txt` : undefined);
    }
    expect(inventory.downloads.filter((download) => download.notice !== undefined).length).toBeGreaterThan(0);
  });
});

describe("download and image records", () => {
  it("records the blog images a page uses and no longer records downloads", () => {
    const docsRoot = writeDocs({
      "docs/guide/a.md": "# A\n\n[Run](../../examples/run.py#L2) [Data](../data.csv) [Readme](../../README.md) [Pkg](../../examples/)\n",
      "docs/data.csv": "a\n",
      "examples/run.py": "x\n",
      "README.md": "# Repo\n",
      "docs/blog/images/chart.png": "png",
      "docs/blog/post.md": "# Post\n\n![Chart](images/chart.png)\n",
    });
    const result = buildSite({ docsRoot: path.join(docsRoot, "docs") });
    expect(result.errors).toEqual([]);
    const guide = result.infos.find((info) => info.path === "guide/a.md");
    expect(guide).not.toHaveProperty("downloads");
    expect(result.infos.find((info) => info.path === "blog/post.md")?.images).toEqual(["chart.png"]);
    expect(JSON.parse(result.files.get("manifest/legacy-files.json") ?? "{}")).toEqual({ images: ["chart.png"] });
  });
});

describe("inventory entries", () => {
  it("lists pages, heading targets, blog post labels and the retired index and search labels", () => {
    const docsRoot = writeDocs({
      "docs/api.md": "---\nmyst:\n  enable_extensions:\n    - attrs_block\n---\n\n# API\n\n{#thing-example}\n\n## Example\n\n(guide-label)=\n## Guide\n",
      "docs/blog/2026-01-01-hello.md": "---\nblogpost: true\ndate: Jan 1, 2026\n---\n\n# Hello\n",
    });
    const result = buildSite({ docsRoot: path.join(docsRoot, "docs") });
    expect(result.errors).toEqual([]);
    const entries = JSON.parse(result.files.get("manifest/inventory-entries.json") ?? "[]") as { name: string; role: string; uri: string }[];
    const find = (role: string, name: string) => entries.find((entry) => entry.role === role && entry.name === name)?.uri;
    expect(find("doc", "api")).toBe("api.html");
    expect(find("label", "thing-example")).toBe("api.html#thing-example");
    expect(find("label", "guide-label")).toBe("api.html#guide-label");
    expect(find("doc", "blog/2026-01-01-hello")).toBe("../blog/2026-01-01-hello.html");
    expect(find("label", "2026-01-01-hello")).toBe("../blog/2026-01-01-hello.html");
    expect(find("label", "genindex")).toBe("genindex.html");
    expect(find("label", "search")).toBe("search.html");
  });
});

describe("objects inventory", () => {
  it("writes a Sphinx version 2 inventory that lists pages and labels", () => {
    const bytes = renderObjectsInventory(
      [
        { name: "usage/start", role: "doc", uri: "usage/start.html", title: "Getting started" },
        { name: "install", role: "label", uri: "usage/start.html#install", title: "Install  BenchBox" },
      ],
      "BenchBox",
      "1.2.3",
    );
    const text = bytes.toString("latin1");
    expect(text.startsWith("# Sphinx inventory version 2\n# Project: BenchBox\n# Version: 1.2.3\n# The remainder of this file is compressed using zlib.\n")).toBe(true);
    const body = bytes.subarray(Buffer.byteLength("# Sphinx inventory version 2\n# Project: BenchBox\n# Version: 1.2.3\n# The remainder of this file is compressed using zlib.\n"));
    expect(inflateSync(body).toString("utf-8")).toBe("usage/start std:doc -1 usage/start.html Getting started\ninstall std:label -1 usage/start.html#install Install BenchBox\n");
  });
});

built("built site", () => {
  it("serves redirect pages for the retired Sphinx pages", () => {
    for (const [file, target] of Object.entries(REDIRECT_PAGES)) {
      const html = readFileSync(path.join(dist as string, file), "utf-8");
      expect(html).toContain(`<meta http-equiv="refresh" content="0; url=${target}">`);
      expect(html).toContain(`<link rel="canonical" href="https://benchbox.dev${target}">`);
      expect(existsSync(path.join(dist as string, target.endsWith("/") ? `${target}index.html` : target))).toBe(true);
    }
    expect(readFileSync(path.join(dist as string, "sitemap.xml"), "utf-8")).not.toContain("genindex");
  });

  it("publishes redirect pages, not copies, for the legacy downloads and sidecars, at the root and under /docs/dev/", () => {
    const redirects = legacyRedirects(loadLegacyDownloads(path.join(repoRoot, "inventory", "legacy-downloads.json")));
    expect(redirects.length).toBeGreaterThan(0);
    for (const prefix of ["", "docs/dev/"]) {
      for (const redirect of redirects) {
        const served = path.join(dist as string, redirect.url.replace(/^\/docs\//, `${prefix === "" ? "docs" : prefix.slice(0, -1)}/`));
        expect(statSync(served).isDirectory()).toBe(true);
        expect(readdirSync(served)).toEqual(["index.html"]);
        expect(readFileSync(path.join(served, "index.html"), "utf-8")).toBe(renderRedirectPage(redirect));
      }
    }
  });

  it("keeps redirects out of the sitemap and leaves no copied template or TPC_EULA.txt file", () => {
    const sitemap = readFileSync(path.join(dist as string, "sitemap.xml"), "utf-8");
    expect(sitemap).not.toContain("_downloads");
    const files = readdirSync(path.join(dist as string, "docs"), { recursive: true, encoding: "utf-8" }).map((entry) => entry.split(path.sep).join("/"));
    const downloads = files.filter((entry) => entry.includes("_downloads/"));
    expect(downloads.length).toBeGreaterThan(0);
    expect(downloads.filter((entry) => statSync(path.join(dist as string, "docs", entry)).isFile() && !entry.endsWith("/index.html"))).toEqual([]);
  });

  it("publishes the legacy image and inventory files", () => {
    const legacy = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".generated", "manifest", "legacy-files.json"), "utf-8")) as { images: string[] };
    for (const name of legacy.images) expect(existsSync(path.join(dist as string, imageUrlPath(name)))).toBe(true);
    const inventory = readFileSync(path.join(dist as string, "docs", "objects.inv"));
    expect(inventory.toString("latin1").startsWith("# Sphinx inventory version 2\n# Project: BenchBox\n")).toBe(true);
  });
});
