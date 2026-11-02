import { afterEach, describe, expect, it } from "vitest";
import { parseNav } from "../src/converter/nav.ts";
import { TAG_CATEGORIES } from "../src/converter/tag-categories.ts";
import { build, cleanup, frontMatterOf } from "./support.ts";

afterEach(cleanup);

const pages = {
  "guides/one.md": "# One\n",
  "guides/two.md": "# Two\n",
  "deep.md": "# Deep\n",
  "last.md": "# Last\n",
  "usage/index.md": "# Usage\n\n- [Deep](../deep.md)\n",
  "a.md": "---\ntags: [beginner, cli]\n---\n\n# A\n",
  "b.md": "---\ntags: [beginner, advanced]\n---\n\n# B\n",
};

const toctreeIndex = [
  "# Home",
  "",
  "```{toctree}",
  ":caption: Guides",
  "",
  "guides/one",
  "Custom Two <guides/two.md>",
  "usage/index",
  "```",
  "",
  "```{toctree}",
  ":caption: Browse by Tag",
  "",
  ...TAG_CATEGORIES.map((category) => `_tags/cat-${category.slug}`),
  "```",
  "",
].join("\n");

const navYaml = [
  "groups:",
  "  - label: Guides",
  "    items:",
  "      - page: guides/one.md",
  "      - page: guides/two.md",
  "        label: Custom Two",
  "      - page: usage/index.md",
  "  - label: Browse by Tag",
  "    generated: tag-categories",
  "",
].join("\n");

const manifestOf = (result: ReturnType<typeof build>) => JSON.parse(result.files.get("manifest/sidebar.json") ?? "{}") as { groups: { label: string; items: { label: string; link: string; items?: unknown[] }[] }[]; order: Record<string, number> };

describe("docs/nav.yml", () => {
  it("builds the sidebar from the file, reproducing the toctree-derived sidebar", () => {
    const fromToctrees = build({ ...pages, "index.md": toctreeIndex, "usage/index.md": `${pages["usage/index.md"]}\n\`\`\`{toctree}\n:hidden:\n\n../deep\n\`\`\`\n` });
    const fromNav = build({ ...pages, "index.md": "# Home\n", "usage/index.md": pages["usage/index.md"], "nav.yml": navYaml.replace("      - page: usage/index.md\n", "      - page: usage/index.md\n        items:\n          - deep.md\n") });
    expect(fromToctrees.errors).toEqual([]);
    expect(fromNav.errors).toEqual([]);
    expect(manifestOf(fromNav).groups[0]).toEqual(manifestOf(fromToctrees).groups[0]);
    const listedOrder = (result: ReturnType<typeof build>) => Object.entries(manifestOf(result).order).filter(([page]) => !page.startsWith("_tags/"));
    expect(listedOrder(fromNav)).toEqual(listedOrder(fromToctrees));
  });

  it("expands the generated tag groups with page counts and keeps unlisted tag categories out of the way", () => {
    const manifest = manifestOf(build({ ...pages, "index.md": "# Home\n", "nav.yml": navYaml }));
    const tags = manifest.groups[1];
    expect(tags.items[0]).toEqual({
      label: "By Audience",
      link: "/docs/_tags/cat-audience.html",
      items: [
        { label: "beginner (2)", link: "/docs/_tags/beginner.html" },
        { label: "advanced (1)", link: "/docs/_tags/advanced.html" },
      ],
    });
  });

  it("records the depth-first position of every listed page and writes it to the page front matter", () => {
    const result = build({ ...pages, "index.md": "# Home\n", "nav.yml": navYaml });
    expect(manifestOf(result).order["index.md"]).toBe(0);
    expect(manifestOf(result).order["guides/one.md"]).toBe(1);
    expect(frontMatterOf(result, "docs/guides/two.md")).toContain("sidebar:\n  order: 2");
  });

  it("reports an entry that is not a page, at its line in nav.yml", () => {
    const result = build({ ...pages, "index.md": "# Home\n", "nav.yml": navYaml.replace("guides/one.md", "guides/missing.md") });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("nav.yml:4");
    expect(result.errors[0].message).toContain("guides/missing.md");
  });

  it("rejects a page listed twice under one parent but allows it under two parents", () => {
    expect(() => parseNav("groups:\n  - label: G\n    items:\n      - a.md\n      - a.md\n")).toThrow(/nav.yml:5.*a.md is listed twice/);
    expect(() => parseNav("groups:\n  - label: G\n    items:\n      - a.md\n  - label: H\n    items:\n      - a.md\n")).not.toThrow();
  });

  it("rejects unknown keys, empty groups and mixed generated and listed items", () => {
    expect(() => parseNav("groups:\n  - label: G\n    entries: []\n")).toThrow(/nav.yml:3.*unknown key "entries"/);
    expect(() => parseNav("groups:\n  - label: G\n    items: []\n")).toThrow(/non-empty list/);
    expect(() => parseNav("groups:\n  - label: G\n    generated: tag-categories\n    items:\n      - a.md\n")).toThrow(/both items and generated/);
    expect(() => parseNav("groups:\n  - label: G\n    generated: nope\n")).toThrow(/unknown source/);
  });

  it("accepts an external link entry", () => {
    const manifest = manifestOf(build({ ...pages, "index.md": "# Home\n", "nav.yml": "groups:\n  - label: G\n    items:\n      - label: Source\n        url: https://example.com/x\n      - last.md\n" }));
    expect(manifest.groups[0].items).toEqual([
      { label: "Source", link: "https://example.com/x" },
      { label: "Last", link: "/docs/last.html" },
    ]);
  });
});
