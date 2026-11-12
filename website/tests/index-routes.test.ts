import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { releaseVersion } from "../src/lib/site-inputs.ts";
import { builtSite } from "./built-site.ts";

const websiteRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const built = builtSite();

describe("index routes", () => {
  it.each(["src/pages/docs/[...dir]/inde[x].astro", "src/pages/blog/inde[x].astro", "src/pages/index.astro"])("has route file %s", (route) => {
    expect(existsSync(path.join(websiteRoot, route))).toBe(true);
  });

  it.skipIf(!built)("builds directory index pages", () => {
    for (const page of ["docs/index.html", "docs/benchmarks/index.html", "blog/index.html"]) expect(existsSync(path.join(built!, page))).toBe(true);
    for (const page of ["docs.html", "docs/benchmarks.html"]) expect(existsSync(path.join(built!, page))).toBe(false);
  });

  it.skipIf(!built)("shows the pinned release on the home page and the documentation landing page", () => {
    const version = releaseVersion();
    const home = readFileSync(path.join(built!, "index.html"), "utf-8");
    expect([...home.matchAll(/class="soft-pill"[^>]*>v(\d+\.\d+\.\d+)</g)].map((match) => match[1])).toEqual([version]);
    expect(readFileSync(path.join(built!, "docs", "README.html"), "utf-8")).toContain(`Current release: <code>v${version}</code>`);
  });
});
