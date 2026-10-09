import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEV_DOCS_PREFIX, mountDevDocs, rebaseDocsLinks } from "../src/lib/dev-docs.ts";

const ORIGIN = "https://benchbox.dev";

describe("docs mounted at /docs/dev/", () => {
  it("does not rebase a URL already under the target prefix twice", () => {
    const html = '<a href="/docs/dev/x.html">a</a><a href="/docs/dev">b</a><a href="https://benchbox.dev/docs/dev/y">c</a>';
    expect(rebaseDocsLinks(html, DEV_DOCS_PREFIX, ORIGIN)).toBe(html);
    expect(rebaseDocsLinks('<a href="/docs/development/z.html">', DEV_DOCS_PREFIX, ORIGIN)).toBe('<a href="/docs/dev/development/z.html">');
  });

  it("rebases docs URLs in every URL attribute, including the absolute origin", () => {
    const html =
      '<link rel="canonical" href="https://benchbox.dev/docs/a.html"/><meta property="og:url" content="https://benchbox.dev/docs/a.html"/>' +
      '<a href="/docs/">d</a><a href="/blog/x.html">b</a><img src="/docs/_images/i.png">';
    expect(rebaseDocsLinks(html, DEV_DOCS_PREFIX, ORIGIN)).toBe(
      '<link rel="canonical" href="https://benchbox.dev/docs/dev/a.html"/><meta property="og:url" content="https://benchbox.dev/docs/dev/a.html"/>' +
        '<a href="/docs/dev/">d</a><a href="/blog/x.html">b</a><img src="/docs/dev/_images/i.png">',
    );
  });

  it("uses the configured origin", () => {
    expect(rebaseDocsLinks('<a href="https://next.benchbox.dev/docs/a.html">', DEV_DOCS_PREFIX, "https://next.benchbox.dev")).toBe(
      '<a href="https://next.benchbox.dev/docs/dev/a.html">',
    );
  });

  it("copies the docs tree under docs/dev and rewrites its pages only", () => {
    const site = mkdtempSync(path.join(os.tmpdir(), "dev-docs-"));
    mkdirSync(path.join(site, "docs", "guide"), { recursive: true });
    writeFileSync(path.join(site, "docs", "index.html"), '<a href="/docs/guide/a.html">a</a>');
    writeFileSync(path.join(site, "docs", "guide", "a.html"), '<a href="/docs/">home</a>');
    writeFileSync(path.join(site, "docs", "objects.inv"), "inventory");
    expect(mountDevDocs(site, ORIGIN)).toBe(2);
    expect(readFileSync(path.join(site, "docs", "index.html"), "utf8")).toBe('<a href="/docs/guide/a.html">a</a>');
    expect(readFileSync(path.join(site, "docs", "dev", "index.html"), "utf8")).toBe('<a href="/docs/dev/guide/a.html">a</a>');
    expect(readFileSync(path.join(site, "docs", "dev", "objects.inv"), "utf8")).toBe("inventory");
    expect(existsSync(path.join(site, "docs", "dev", "dev"))).toBe(false);
  });
});
