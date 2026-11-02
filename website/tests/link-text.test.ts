import { afterEach, describe, expect, it } from "vitest";
import { build, cleanup } from "./support.ts";

afterEach(cleanup);

function messages(files: Record<string, string>): string[] {
  return build(files).errors.map((error) => error.message);
}

describe("links without text", () => {
  it("fail for pages, fragments, same-page anchors and external targets", () => {
    expect(messages({ "a.md": "# A\n\n[](other.md)\n", "other.md": "# Other\n" })).toEqual(["a.md:3: link:other.md has no link text; write the text"]);
    expect(messages({ "a.md": "# A\n\n## Sec\n\n[](other.md#sec)\n", "other.md": "# Other\n\n## Sec\n" })).toEqual(["a.md:5: link:other.md#sec has no link text; write the text"]);
    expect(messages({ "a.md": "# A\n\n## Local Sec\n\n[](#local-sec)\n" })).toEqual(["a.md:5: link:#local-sec has no link text; write the text"]);
    expect(messages({ "a.md": "# A\n\n[](https://example.com)\n" })).toEqual(["a.md:3: link:https://example.com has no link text; write the text"]);
  });

  it("fail for generated blog pages too", () => {
    expect(messages({ "blog/index.md": "# Blog\n\n[](archive.html)\n" })).toEqual(["blog/index.md:3: link:archive.html has no link text; write the text"]);
  });

  it("accept a link whose text is an image or code", () => {
    expect(build({ "a.md": "# A\n\n[`x`](https://example.com) [![i](https://example.com/i.png)](https://example.com)\n" }).errors).toEqual([]);
  });
});
