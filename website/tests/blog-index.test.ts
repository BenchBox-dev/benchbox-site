import { afterEach, describe, expect, it } from "vitest";
import { excerptOf } from "../src/lib/blog.ts";
import { build, cleanup, frontMatterOf } from "./support.ts";

afterEach(cleanup);

const LIST = "```{postlist}\n:excerpts:\n```";

describe("blog index", () => {
  it("is native when the index has no post list, and keeps its own anchors", () => {
    const result = build({ "blog/index.md": '<span id="id1"></span>\n\n# Blog\n\nIntro.\n' });
    expect(result.errors).toEqual([]);
    const front = frontMatterOf(result, "blog/index.md");
    expect(front).toContain("nativeIndex: true");
    expect(front).toContain("titleId: blog");
  });

  it("stays converter-rendered while the index still carries a post list", () => {
    const result = build({ "blog/index.md": `# Blog\n\n${LIST}\n` });
    expect(frontMatterOf(result, "blog/index.md")).not.toContain("nativeIndex");
  });

  it("does not mark other blog pages or docs", () => {
    const result = build({ "blog/post.md": "---\nblogpost: true\ndate: Jan 1, 2026\n---\n\n# P\n", "index.md": "# Home\n" });
    expect(frontMatterOf(result, "blog/post.md")).not.toContain("nativeIndex");
    expect(frontMatterOf(result, "docs/index.md")).not.toContain("nativeIndex");
  });
});

describe("excerptOf", () => {
  it("takes the first paragraph with text, drops links and images and keeps inline markup", () => {
    const html = '<p><img src="x.png"></p>\n<p>See <a href="/y">the <em>new</em> page</a> for <code>x</code>.\nMore.</p><p>Second.</p>';
    expect(excerptOf(html)).toBe("See the <em>new</em> page for <code>x</code>. More.");
  });

  it("is undefined without a text paragraph", () => {
    expect(excerptOf("<h2>Only</h2>")).toBeUndefined();
    expect(excerptOf(undefined)).toBeUndefined();
  });
});
