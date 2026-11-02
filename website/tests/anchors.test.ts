import { afterEach, describe, expect, it } from "vitest";
import type { UnknownConstructError } from "../src/converter/errors.ts";
import { build, bodyOf, cleanup, frontMatterOf } from "./support.ts";

afterEach(cleanup);

function messages(files: Record<string, string>): string[] {
  return build(files).errors.map((error) => error.message);
}

describe("raw span anchors", () => {
  it("passes bare span anchors through and registers their ids for fragment links", () => {
    const result = build({
      "a.md": '# A\n\n<span id="pkg.Class"></span>\n\nInline <span id="inline-a"></span>text.\n\n<span id="lead"></span><span id="lead.two"></span>Lead text.\n',
      "b.md": "# B\n\n[x](a.md#pkg.Class) [y](a.md#inline-a) [z](a.md#lead.two)\n",
    });
    expect(result.errors).toEqual([]);
    expect(bodyOf(result, "docs/a.md")).toContain('<span id="lead"></span><span id="lead.two"></span>Lead text.');
    expect(bodyOf(result, "docs/b.md")).toContain("[x](/docs/a.html#pkg.Class) [y](/docs/a.html#inline-a) [z](/docs/a.html#lead.two)");
  });

  it("rejects span anchors with other attributes and duplicate ids", () => {
    expect(messages({ "a.md": '# A\n\nSee <span id="x" class="c"></span>here.\n' })).toEqual([expect.stringContaining('must be a bare <span id="..."> anchor')]);
    expect(messages({ "a.md": '# A\n\n<span id="dup"></span>x <span id="dup"></span>y\n' })).toEqual([expect.stringContaining('raw html id "dup" is already used')]);
    expect(messages({ "a.md": '# A\n\n<span id="intro"></span>x\n\n## Intro\n' })).toEqual([expect.stringContaining('raw html id "intro" duplicates an id')]);
  });
});

describe("closed gaps", () => {
  it("rejects $$ math", () => {
    expect(build({ "a.md": "# A\n\n$$x^2$$\n" }).errors.map((error) => (error as UnknownConstructError).construct)).toEqual(["syntax:math"]);
  });

  it("rejects unknown elements with content and unknown html blocks", () => {
    expect(messages({ "a.md": "# A\n\n<custom-el>hi</custom-el>\n" })).toEqual([expect.stringContaining('raw html "</custom-el>"')]);
    expect(messages({ "a.md": "# A\n\n<custom-el>\n\nText.\n" })).toEqual([expect.stringContaining('raw html "<custom-el>"')]);
  });

  it("keeps a lone unknown inline tag as literal text", () => {
    const result = build({ "a.md": "# A\n\nRun with --platform <name> today.\n" });
    expect(result.errors).toEqual([]);
  });
});
