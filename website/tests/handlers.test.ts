import { afterEach, describe, expect, it } from "vitest";
import { UnknownConstructError, UnresolvedReferenceError } from "../src/converter/errors.ts";
import { buildSite } from "../src/converter/build.ts";
import { build, bodyOf, cleanup, frontMatterOf, pageOf, STUB, writeDocs } from "./support.ts";

afterEach(cleanup);

describe("front matter", () => {
  it("passes known keys through and maps meta_description to description", () => {
    const result = build({
      "post.md": "---\nmeta_description: A short summary\nauthor: Joe\ndate: 2026-01-02\n---\n\n# Post\n",
    });
    expect(result.errors).toEqual([]);
    const front = frontMatterOf(result, "docs/post.md");
    expect(front).toContain("description: A short summary");
    expect(front).toContain("author: Joe");
    expect(front).toContain("date: 2026-01-02");
  });

  it.each(["draft", "Draft", "DRAFT", " draft "])("rejects %j blog articles without emitting public pages", (status) => {
    const result = build({
      "blog/candidate.md": `---\nblogpost: true\ndate: October 19, 2026\nstatus: ${JSON.stringify(status)}\n---\n\n# Candidate\n\nUnapproved article.\n`,
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ file: "blog/candidate.md", line: 4 });
    expect(result.files.size).toBe(0);
  });

  it("rejects blog articles with draft status in an array", () => {
    const result = build({
      "blog/candidate.md": "---\nblogpost: true\ndate: October 19, 2026\nstatus:\n  - Draft\n---\n\n# Candidate\n\nUnapproved article.\n",
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ file: "blog/candidate.md", line: 4 });
    expect(result.files.size).toBe(0);
  });

  it("rejects blog articles that carry a hold field and ignores it elsewhere", () => {
    const held = build({
      "blog/candidate.md": '---\nblogpost: true\ndate: October 19, 2026\nhold: "withheld"\n---\n\n# Candidate\n\nHeld article.\n',
    });
    expect(held.errors).toHaveLength(1);
    expect(held.errors[0]).toMatchObject({ file: "blog/candidate.md", line: 4 });
    expect(held.errors[0].message).toContain("on hold");
    expect(held.files.size).toBe(0);
    const docs = build({ "guide.md": "---\nhold: later\n---\n\n# Guide\n\nNotes.\n" });
    expect(docs.errors).toEqual([]);
  });

  it.each(["published", undefined])("allows %s blog articles alongside draft documentation", (status) => {
    const result = build({
      "guide.md": "---\nstatus: draft\n---\n\n# Guide\n\nWork in progress.\n",
      "blog/post.md": `---\nblogpost: true\ndate: October 19, 2026\n${status ? `status: ${status}\n` : ""}---\n\n# Published article\n\nReviewed article.\n`,
    });
    expect(result.errors).toEqual([]);
    expect(result.files.has("content/docs/guide.md")).toBe(true);
    expect(result.files.has("content/blog/post.md")).toBe(true);
  });

  it("rejects an unknown key with its file and line", () => {
    const result = build({ "a.md": "---\nmystery: 1\n---\n\n# A\n" });
    expect(result.errors).toHaveLength(1);
    const [error] = result.errors;
    expect(error).toBeInstanceOf(UnknownConstructError);
    expect(error.file).toBe("a.md");
    expect(error.line).toBe(2);
    expect((error as UnknownConstructError).construct).toBe("front-matter:mystery");
  });

  it("rejects the myst front matter key, which this site does not read", () => {
    const result = build({ "a.md": "---\nmyst:\n  enable_extensions:\n    - colon_fence\n---\n\n# A\n" });
    expect(result.errors).toHaveLength(1);
    expect((result.errors[0] as UnknownConstructError).construct).toBe("front-matter:myst");
  });

  it("uses a front matter title when there is no first-level heading", () => {
    const result = build({ "a.md": "---\ntitle: From Front Matter\n---\n\nBody text.\n" });
    expect(result.errors).toEqual([]);
    expect(frontMatterOf(result, "docs/a.md")).toContain("title: From Front Matter");
  });

  it("reports a document without any title", () => {
    const result = build({ "a.md": "Just text.\n" });
    expect(result.errors[0].message).toContain("no title");
  });
});

describe("tags front matter", () => {
  it("writes tags to front matter and the tag manifest", () => {
    const result = build({ "a.md": "---\ntags: [beginner, cli]\n---\n\n# A\n", "b.md": "---\ntags: cli\n---\n\n# B\n" });
    expect(result.errors).toEqual([]);
    expect(frontMatterOf(result, "docs/a.md")).toContain("tags:\n  - beginner\n  - cli");
    const manifest = JSON.parse(result.files.get("manifest/tags.json") ?? "{}") as Record<string, { path: string }[]>;
    expect(Object.keys(manifest)).toEqual(["beginner", "cli"]);
    expect(manifest.cli.map((page) => page.path)).toEqual(["a.md", "b.md"]);
  });
});

describe("comments", () => {
  it("drops html comments", () => {
    const result = build({ "a.md": "<!-- licence -->\n\n# A\n\nText <!-- inline --> more.\n" });
    expect(result.errors).toEqual([]);
    expect(pageOf(result, "docs/a.md")).not.toContain("licence");
    expect(pageOf(result, "docs/a.md")).not.toContain("inline");
  });

  it("keeps a percent line as ordinary text", () => {
    const result = build({ "a.md": "# A\n\n% of rows\n" });
    expect(bodyOf(result, "docs/a.md")).toContain("% of rows");
  });
});

describe("heading ids", () => {
  it("numbers duplicate headings id1, id2 as docutils does", () => {
    const result = build({ "a.md": "# A\n\n## Setup\n\n## Setup\n\n## Setup\n\n## !!!\n" });
    expect(frontMatterOf(result, "docs/a.md")).toContain("headingIds:\n  - setup\n  - id1\n  - id2\n  - id3");
  });

  it("keeps the document title id as an alias span for docs only", () => {
    const result = build({ "a.md": "# Getting Started\n\nText.\n", "blog/post.md": "# Post Title\n\nText.\n" });
    expect(bodyOf(result, "docs/a.md")).toContain('<span id="getting-started"></span>');
    expect(bodyOf(result, "blog/post.md")).not.toContain("<span");
    expect(frontMatterOf(result, "blog/post.md")).toContain("titleId: post-title");
  });

  it("matches docutils for non-ascii titles and leading digits", () => {
    const result = build({ "a.md": "# A\n\n## 1. Step\n\n## Æther Straße\n" });
    expect(frontMatterOf(result, "docs/a.md")).toContain("  - step\n  - aether-strasze");
  });
});

describe("links", () => {
  it("rewrites markdown links and keeps fragments, external and anchor links", () => {
    const result = build({
      "a/x.md": "# X\n\n## Here\n\n[b](../b.md#part) [ext](https://example.com/p.md) [here](#here) [mail](mailto:a@b.c)\n",
      "b.md": "# B\n\n## Part\n",
    });
    expect(result.errors).toEqual([]);
    expect(bodyOf(result, "docs/a/x.md")).toContain("[b](/docs/b.html#part) [ext](https://example.com/p.md) [here](#here) [mail](mailto:a@b.c)");
  });

  it("resolves extensionless and trailing-slash doc targets ", () => {
    const result = build({
      "guide/a.md": "# A\n\n[x](../ref/api/platforms/) [y](../ref/api/platforms) [z](../ref) [w](./)\n",
      "ref/api/platforms.md": "# Platforms\n",
      "ref/api/platforms/duckdb.md": "# DuckDB\n",
      "ref/index.md": "# Ref\n",
      "guide/index.md": "# Guide\n",
    });
    expect(result.errors).toEqual([]);
    expect(bodyOf(result, "docs/guide/a.md")).toContain(
      "[x](/docs/ref/api/platforms.html) [y](/docs/ref/api/platforms.html) [z](/docs/ref/index.html) [w](/docs/guide/index.html)",
    );
  });

  it("fails on any reStructuredText page, which this site does not build", () => {
    const result = build({ "a.md": "# A\n\n[api](api/core.rst)\n", "api/core.rst": "Core\n====\n" });
    expect(result.errors.map((error) => error.message)).toEqual([
      "api/core.rst:1: reStructuredText pages are not built by this site; convert the page to Markdown",
      "a.md:3: link:api/core.rst does not match a document under docs/ (looked for api/core.md)",
    ]);
  });

  it("does not resolve object prototype names as blog pages", () => {
    const result = build({ "blog/index.md": "# Blog\n\n[x](constructor) [y](toString)\n" });
    expect(result.errors.map((error) => (error as UnresolvedReferenceError).reference)).toEqual(["link:constructor", "link:toString"]);
  });

  it("fails on unresolvable relative targets with file and line", () => {
    const result = build({ "a.md": "# A\n\n[d](nowhere/)\n\n[h](other.html) [s](sub/)\n", "sub/page.md": STUB, "other.md": STUB });
    expect(result.errors.map((error) => [error.file, error.line, (error as UnresolvedReferenceError).reference])).toEqual([
      ["a.md", 3, "link:nowhere/"],
      ["a.md", 5, "link:other.html"],
      ["a.md", 5, "link:sub/"],
    ]);
  });

  it("validates fragments against the target page ids", () => {
    const result = build({
      "a.md": "# A\n\n[ok](b.md#sec) [label](b.md#lbl) [bad](b.md#nope) [self](#gone) [bare](b#sec)\n",
      "b.md": "# B\n\n## Sec\n\n<span id=\"lbl\"></span>\n\nText.\n",
    });
    expect(result.errors.map((error) => (error as UnresolvedReferenceError).reference)).toEqual(["link:b.md#nope", "link:a.md#gone", "link:b#sec"]);
  });

  it("allows only the broken fragments listed as known breakage", () => {
    const docsRoot = writeDocs({ "a.md": "# A\n\n[bad](b.md#nope) [other](b.md#also)\n", "b.md": STUB });
    const result = buildSite({ docsRoot, knownBrokenLinks: new Set(["/docs/a.html /docs/b.html#nope"]) });
    expect(result.errors.map((error) => (error as UnresolvedReferenceError).reference)).toEqual(["link:b.md#also"]);
  });

  it("fails on a markdown link to a missing document", () => {
    const result = build({ "a.md": "# A\n\n[gone](gone.md)\n" });
    expect(result.errors[0].message).toContain("link:gone.md");
  });

  it("links blog pages under /blog/", () => {
    const result = build({ "a.md": "# A\n\n[post](blog/p.md)\n", "blog/p.md": "# P\n" });
    expect(bodyOf(result, "docs/a.md")).toContain("[post](/blog/p.html)");
  });
});

describe("MyST syntax", () => {
  it("rejects a directive fence at its line", () => {
    const result = build({ "a.md": "# A\n\ntext\n\n```{note}\nbody\n```\n" });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBeInstanceOf(UnknownConstructError);
    expect(result.errors[0].message).toContain("a.md:5");
  });

  it("rejects a role before an inline code span, including on later lines of a paragraph", () => {
    const result = build({ "a.md": "# A\n\nfirst line\nsecond {doc}`x` line\n" });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("a.md:4");
  });

  it("rejects a label line at its line", () => {
    const result = build({ "a.md": "# A\n\n(my-label)=\n\n## Section\n" });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("a.md:3");
  });

  it("reports every occurrence in a document, not only the first", () => {
    const result = build({ "a.md": "# A\n\n```{one}\n```\n\n```{two}\n```\n" });
    expect(result.errors.map((error) => error.line)).toEqual([3, 6]);
  });

  it("accepts braces in ordinary text and in code", () => {
    const result = build({ "a.md": "# A\n\nUse {name} placeholders and `{name}` in code, then:\n\n```python\nf\"{value}\"\n```\n" });
    expect(result.errors).toEqual([]);
  });
});

describe("colon fences", () => {
  it("renders a colon fence as a plain paragraph", () => {
    const result = build({ "a.md": "# A\n\n:::{note}\nhi\n:::\n" });
    expect(result.errors).toEqual([]);
    expect(bodyOf(result, "docs/a.md")).toContain("&#58;::{note}\nhi\n&#58;::");
  });

  it("escapes a colon fence inside a blockquote, including on later lines", () => {
    const result = build({ "a.md": "# A\n\n> :::note\n> quoted\n> :::\n\n> Intro\n> :::tip\n" });
    expect(result.errors).toEqual([]);
    const body = bodyOf(result, "docs/a.md");
    expect(body).toContain("> &#58;::note\n> quoted\n> &#58;::");
    expect(body).toContain("> Intro\n> &#58;::tip");
  });

  it("escapes a brace-less :::note fence so the page renders it as literal text", () => {
    const result = build({ "a.md": "# A\n\nIntro line\n:::note\nliteral *text*\n:::\n" });
    expect(result.errors).toEqual([]);
    expect(bodyOf(result, "docs/a.md")).toContain("Intro line\n&#58;::note\nliteral *text*\n&#58;::");
  });
});

describe("plain markdown passthrough", () => {
  it("keeps tables, lists, emphasis, code and footnotes", () => {
    const source = "# A\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- one\n- two\n\n*em* **strong** `code` ~~gone~~\n\n```python\nprint(1)\n```\n";
    const result = build({ "a.md": source });
    expect(result.errors).toEqual([]);
    const body = bodyOf(result, "docs/a.md");
    expect(body).toContain("| a | b |");
    expect(body).toContain("- one\n- two");
    expect(body).toContain("*em* **strong** `code` ~~gone~~");
    expect(body).toContain("```python\nprint(1)\n```");
  });
});
