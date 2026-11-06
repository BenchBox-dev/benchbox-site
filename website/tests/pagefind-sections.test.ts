import { describe, expect, it } from "vitest";
import { inSection } from "../scripts/pagefind-index.mjs";

describe("search section filter", () => {
  it("scopes a page that has no explicit body to the whole body", () => {
    const html = inSection('<html><body class="a"><main>x</main></body></html>', "Docs");
    expect(html).toContain('<body data-pagefind-filter="section:Docs" class="a">');
  });

  it("keeps the filter inside an explicit indexed body, where Pagefind reads it", () => {
    const html = inSection('<body><main id="main" data-pagefind-body="">x</main></body>', "Results");
    expect(html).toContain('<main id="main" data-pagefind-body="" data-pagefind-filter="section:Results">');
    expect(html).not.toContain("<body data-pagefind-filter");
  });

  it("replaces a section the page already declares", () => {
    const html = inSection('<body data-pagefind-filter="section:Blog"><main>x</main></body>', "Docs");
    expect(html.match(/data-pagefind-filter/g)).toHaveLength(1);
    expect(html).toContain("section:Docs");
  });
});
