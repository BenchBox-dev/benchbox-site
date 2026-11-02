import { afterEach, describe, expect, it } from "vitest";
import { displayTag, tagBasename } from "../src/converter/tag-pages.ts";
import { build, bodyOf, cleanup, pageOf } from "./support.ts";

afterEach(cleanup);

const files = {
  "index.md": "# Home\n\n- [By Audience](_tags/cat-audience.md)\n- [By Feature](_tags/cat-feature.md)\n",
  "nav.yml": "groups:\n  - label: Browse by Tag\n    generated: tag-categories\n",
  "README.md": "---\ntags: [beginner, cli]\n---\n\n# Readme\n",
  "usage/index.md": "---\ntags: [beginner, Python API]\n---\n\n# Usage\n",
  "Zeta.md": "---\ntags: [advanced]\n---\n\n# Zeta Guide\n",
  "platforms/duck.md": "---\ntags: [reference, python-api]\n---\n\n# Duck Platform\n\nBody text.\n",
  "plain.md": "# Plain\n",
  "blog/2026-01-01-post.md": "---\nblogpost: true\ndate: Jan 1, 2026\ntags: beginner, blogonly\n---\n\n# A post\n\nBody.\n",
};

const GOLDEN_BEGINNER = `---
title: "Tagged with: beginner"
sourcePath: docs/_tags/beginner.md
titleId: tagged-with-beginner
sidebar:
  order: 2
---

<span id="tagged-with-beginner"></span>

**Pages with this tag**

- [Readme](/docs/README.html)
- [Usage](/docs/usage/index.html)
`;

describe("tag page generation", () => {
  it("emits a golden tag page at the stable tag route", () => {
    const result = build(files);
    expect(result.errors).toEqual([]);
    expect(pageOf(result, "docs/_tags/beginner.md")).toBe(GOLDEN_BEGINNER);
  });

  it("emits one page per tag, category and the tags index, ignoring blog front matter tags", () => {
    const result = build(files);
    const generated = [...result.files.keys()].filter((key) => key.startsWith("content/docs/_tags/")).sort();
    expect(generated).toEqual(
      [
        "advanced",
        "beginner",
        "cat-audience",
        "cat-benchmark",
        "cat-content-type",
        "cat-feature",
        "cat-platform",
        "cat-platform-type",
        "cli",
        "python-api",
        "reference",
        "tagsindex",
      ]
        .map((name) => `content/docs/_tags/${name}.md`)
        .sort(),
    );
  });

  it("sorts listed pages by source path", () => {
    const result = build(files);
    const body = bodyOf(result, "docs/_tags/python-api.md");
    expect(body.indexOf("[Usage](/docs/usage/index.html)")).toBeGreaterThan(-1);
    expect(body.indexOf("[Duck Platform](/docs/platforms/duck.html)")).toBeGreaterThan(-1);
    expect(body.indexOf("Duck Platform")).toBeLessThan(body.indexOf("Usage"));
    const advanced = bodyOf(result, "docs/_tags/advanced.md");
    expect(advanced).toContain("- [Zeta Guide](/docs/Zeta.html)");
  });

  it("lists category tags with counts in category order and skips absent tags", () => {
    const result = build(files);
    const audience = bodyOf(result, "docs/_tags/cat-audience.md");
    expect(audience).toContain("- [beginner (2)](/docs/_tags/beginner.html)");
    expect(audience).toContain("- [advanced (1)](/docs/_tags/advanced.html)");
    expect(audience).not.toContain("intermediate");
    expect(audience.indexOf("beginner")).toBeLessThan(audience.indexOf("advanced"));
    expect(bodyOf(result, "docs/_tags/cat-benchmark.md")).toContain("*No tags in this category yet.*");
    expect(pageOf(result, "docs/_tags/cat-feature.md")).toContain("title: By Feature");
  });

  it("nests category tags under the tags index", () => {
    const result = build(files);
    const body = bodyOf(result, "docs/_tags/tagsindex.md");
    expect(body).toContain("- [By Audience](/docs/_tags/cat-audience.html)\n  - [beginner (2)](/docs/_tags/beginner.html)");
    expect(pageOf(result, "docs/_tags/tagsindex.md")).toContain("title: Browse by Tag");
  });

  it("generates nothing when no page has tags", () => {
    const result = build({ "index.md": "# Home\n" });
    expect([...result.files.keys()].some((key) => key.includes("_tags"))).toBe(false);
  });
});

describe("links to generated tag pages", () => {
  it("resolves _tags category links from a page without errors", () => {
    const result = build(files);
    expect(result.errors).toEqual([]);
    expect(bodyOf(result, "docs/index.md")).toContain("- [By Audience](/docs/_tags/cat-audience.html)");
  });

  it("places generated pages in the sidebar under the generated tag group", () => {
    const result = build(files);
    const sidebar = JSON.parse(result.files.get("manifest/sidebar.json") ?? "{}") as { groups: { label: string; items: { link: string; items?: { link: string }[] }[] }[] };
    expect(sidebar.groups[0].label).toBe("Browse by Tag");
    expect(sidebar.groups[0].items.map((item) => item.link)).toEqual([
      "/docs/_tags/cat-audience.html",
      "/docs/_tags/cat-benchmark.html",
      "/docs/_tags/cat-platform.html",
      "/docs/_tags/cat-platform-type.html",
      "/docs/_tags/cat-content-type.html",
      "/docs/_tags/cat-feature.html",
    ]);
    expect(sidebar.groups[0].items[0].items?.map((item) => item.link)).toEqual(["/docs/_tags/beginner.html", "/docs/_tags/advanced.html"]);
  });

  it("still reports links to a tag page that does not exist", () => {
    const result = build({ "index.md": "# Home\n\n[tags](_tags/cat-audience.md)\n" });
    expect(result.errors.map((error) => error.message).join("\n")).toContain("_tags/cat-audience");
  });

  it("records blog post tags in the manifest only: no blog tag page is built", () => {
    const result = build(files);
    expect([...result.files.keys()].filter((name) => name.startsWith("content/blog/") || name.includes("blogonly"))).toEqual(["content/blog/2026-01-01-post.md"]);
    const tags = JSON.parse(result.files.get("manifest/tags.json") ?? "{}") as Record<string, { path: string }[]>;
    expect(tags.blogonly.map((entry) => entry.path)).toEqual(["blog/2026-01-01-post.md"]);
  });
});

describe("tag helpers", () => {
  it("normalizes display names and file basenames like sphinx-tags", () => {
    expect(displayTag('"Tag:with   (extra) whitespace"')).toBe("Tag:with (extra) whitespace");
    expect(tagBasename("Tag:with (special   characters) ")).toBe("tag-with-special-characters");
    expect(tagBasename("python-api")).toBe("python-api");
  });

});
