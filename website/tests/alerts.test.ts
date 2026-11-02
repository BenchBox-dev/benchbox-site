import { afterEach, describe, expect, it } from "vitest";
import { build, bodyOf, cleanup, pageOf } from "./support.ts";

afterEach(cleanup);

describe("GitHub alerts", () => {
  it.each([
    ["NOTE", "note", "Note"],
    ["TIP", "tip", "Tip"],
    ["IMPORTANT", "caution", "Important"],
    ["WARNING", "caution", "Warning"],
    ["CAUTION", "danger", "Caution"],
  ])("maps [!%s] to a %s callout titled %s", (kind, type, title) => {
    const result = build({ "a.md": `# A\n\n> [!${kind}]\n> Body **text**.\n` });
    expect(result.errors).toEqual([]);
    const body = bodyOf(result, "docs/a.mdx");
    expect(body).toContain(`<Callout type="${type}" title="${title}">`);
    expect(body).toContain("Body **text**.");
    expect(body).not.toContain("[!");
    expect(pageOf(result, "docs/a.mdx")).toContain('import Callout from "../../../src/components/docs/Callout.astro";');
  });

  it("keeps lists, links and later paragraphs inside the callout", () => {
    const result = build({ "a.md": "# A\n\n> [!TIP]\n> - see [B](b.md)\n> - [ext](https://example.com)\n>\n> Closing paragraph.\n", "b.md": "# B\n" });
    expect(result.errors).toEqual([]);
    const body = bodyOf(result, "docs/a.mdx");
    expect(body).toContain("- see [B](/docs/b.html)");
    expect(body).toContain("Closing paragraph.");
    expect(body.match(/<Callout /g)).toHaveLength(1);
  });

  it("leaves an ordinary blockquote and an unknown alert kind as quotes", () => {
    const result = build({ "a.md": "# A\n\n> plain quote\n\n> [!DANGER]\n> not an alert\n" });
    expect(result.errors).toEqual([]);
    expect(pageOf(result, "docs/a.md")).not.toContain("Callout");
  });

  it("rejects a heading inside an alert as it does inside any quote", () => {
    const result = build({ "a.md": "# A\n\n> [!NOTE]\n>\n> ## Inner\n" });
    expect(result.errors[0].message).toContain("a.md:5");
  });
});

describe("mermaid fences", () => {
  it("emits the Mermaid component with the diagram source", () => {
    const result = build({ "a.md": '# A\n\n```mermaid\ngraph TD\n  A["x"] --> B{y}\n```\n' });
    expect(result.errors).toEqual([]);
    expect(bodyOf(result, "docs/a.mdx")).toContain(String.raw`graph TD\n  A[\"x\"] --> B{y}`);
    expect(pageOf(result, "docs/a.mdx")).toContain('import Mermaid from "../../../src/components/docs/Mermaid.astro";');
  });

  it("rejects an empty diagram at its fence line", () => {
    const result = build({ "a.md": "# A\n\n```mermaid\n```\n" });
    expect(result.errors[0].message).toContain("a.md:3");
  });
});
