import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "parse5";
import { describe, expect, it } from "vitest";
import { shellBrand, shellCta, shellLabels, shellLinks } from "../src/lib/header-links.ts";
import { builtSite } from "./built-site.ts";

interface Node5 {
  nodeName: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Node5[];
  value?: string;
}

interface Anchor {
  text: string;
  href: string | undefined;
  current: string | undefined;
}

interface Header {
  brand: Anchor | undefined;
  navLabel: string | undefined;
  links: Anchor[];
  cta: Anchor | undefined;
  toggleLabel: string | undefined;
  themeLabels: string[];
}

const attr = (node: Node5, name: string) => node.attrs?.find((entry) => entry.name === name)?.value;
const hasClass = (node: Node5, name: string) => (attr(node, "class") ?? "").split(/\s+/).includes(name);

function descendants(node: Node5): Node5[] {
  return (node.childNodes ?? []).flatMap((child) => [child, ...descendants(child)]);
}

function textOf(node: Node5): string {
  return descendants(node)
    .filter((child) => child.nodeName === "#text")
    .map((child) => child.value ?? "")
    .join("")
    .trim();
}

const anchor = (node: Node5): Anchor => ({ text: textOf(node), href: attr(node, "href"), current: attr(node, "aria-current") });

export function inspectHeader(html: string): Header {
  const all = descendants(parse(html) as unknown as Node5);
  const headers = all.filter((node) => attr(node, "data-site-header") !== undefined);
  expect(headers).toHaveLength(1);
  const inside = descendants(headers[0]);
  const nav = inside.find((node) => node.nodeName === "nav" && attr(node, "aria-label") === shellLabels.nav);
  const navNodes = nav ? descendants(nav).filter((node) => node.nodeName === "a") : [];
  return {
    brand: inside.filter((node) => node.nodeName === "a" && hasClass(node, "site-header__logo")).map(anchor)[0],
    navLabel: nav ? attr(nav, "aria-label") : undefined,
    links: navNodes.filter((node) => hasClass(node, "site-header__link")).map(anchor),
    cta: navNodes.filter((node) => hasClass(node, "site-header__cta")).map(anchor)[0],
    toggleLabel: inside.find((node) => node.nodeName === "button" && attr(node, "data-site-header-toggle") !== undefined)?.attrs?.find((entry) => entry.name === "aria-label")?.value,
    themeLabels: inside.filter((node) => node.nodeName === "button" && attr(node, "data-theme-toggle") !== undefined).map((node) => attr(node, "aria-label") ?? ""),
  };
}

function expectedHeader(pathname: string): Header {
  const brand = shellBrand();
  const cta = shellCta();
  return {
    brand: { text: brand.label, href: brand.href, current: undefined },
    navLabel: shellLabels.nav,
    links: shellLinks(pathname).map((link) => ({ text: link.label, href: link.href, current: link.current ? "page" : undefined })),
    cta: { text: cta.label, href: cta.href, current: undefined },
    toggleLabel: shellLabels.toggle,
    themeLabels: [],
  };
}

function assertContract(html: string, pathname: string) {
  const expected = expectedHeader(pathname);
  const actual = inspectHeader(html);
  expect({ ...actual, themeLabels: [] }).toEqual(expected);
  expect(actual.themeLabels).toHaveLength(1);
  expect(actual.themeLabels[0]).toMatch(new RegExp(`^${shellLabels.theme}: `));
}

const built = builtSite();
const surfaces = [
  { surface: "landing", pathname: "/", file: "index.html" },
  { surface: "prompts", pathname: "/prompts/", file: path.join("prompts", "index.html") },
];

describe("built page header contract", () => {
  describe.skipIf(!built).each(surfaces)("$surface", ({ pathname, file }) => {
    const html = () => readFileSync(path.join(built!, file), "utf-8");

    it("matches the shared header contract", () => {
      assertContract(html(), pathname);
    });

    it("marks only the expected link as the current page", () => {
      const current = inspectHeader(html())
        .links.filter((link) => link.current === "page")
        .map((link) => link.text);
      expect(current).toEqual(shellLinks(pathname).filter((link) => link.current).map((link) => link.label));
    });

    it("rejects a header with a removed link", () => {
      const source = html();
      const broken = source.replace(/<a class="site-header__link"[^>]*>Blog<\/a>/, "");
      expect(broken).not.toBe(source);
      expect(() => assertContract(broken, pathname)).toThrow();
    });

    it("rejects a header with a wrong link target", () => {
      const source = html();
      const broken = source.replace('href="/docs/"', 'href="/elsewhere/"');
      expect(broken).not.toBe(source);
      expect(() => assertContract(broken, pathname)).toThrow();
    });

    it("rejects a header without the theme button", () => {
      const source = html();
      const broken = source.replaceAll("data-theme-toggle", "data-removed");
      expect(broken).not.toBe(source);
      expect(() => assertContract(broken, pathname)).toThrow();
    });
  });
});
