import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateDocsPages, inGeneratedScope } from "../src/lib/docs-generators/generate.ts";
import { loadDocsData } from "../src/lib/docs-generators/docs-data.ts";
import { assembleAuthoredDocs, bundleManifest, DocsAssemblyError, LANDING_VERSION_TOKEN, siteInputsPath } from "../src/lib/site-inputs.ts";

const workDir = mkdtempSync(path.join(os.tmpdir(), "site-inputs-"));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

function authoredTree(name: string, files: Record<string, string>): string {
  const root = path.join(workDir, name);
  for (const [relative, content] of Object.entries({ "README.md": `Current release: \`v${LANDING_VERSION_TOKEN}\`.\n`, ...files })) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), content);
  }
  return root;
}

const inputs = siteInputsPath();

describe("assembling the authored documentation", () => {
  it("combines the site's pages, the generated pages and the versioned landing page", () => {
    const destination = path.join(workDir, "assembled");
    const docsRoot = assembleAuthoredDocs(destination, inputs, authoredTree("ok", { "usage/page.md": "# Page\n" }));
    const version = bundleManifest().package_version;
    expect(readFileSync(path.join(docsRoot, "README.md"), "utf-8")).toBe(`Current release: \`v${version}\`.\n`);
    expect(readFileSync(path.join(docsRoot, "usage", "page.md"), "utf-8")).toBe("# Page\n");
    const generated = generateDocsPages(loadDocsData(path.join(inputs, "docs-data", "docs-data.json")));
    expect(generated.size).toBeGreaterThan(0);
    for (const [relative, content] of generated) expect(readFileSync(path.join(docsRoot, relative), "utf-8")).toBe(content);
    expect([...generated.keys()].every(inGeneratedScope)).toBe(true);
  });

  it("starts from a clean destination", () => {
    const destination = path.join(workDir, "clean");
    mkdirSync(destination, { recursive: true });
    writeFileSync(path.join(destination, "stale.txt"), "stale");
    assembleAuthoredDocs(destination, inputs, authoredTree("clean-source", {}));
    expect(existsSync(path.join(destination, "stale.txt"))).toBe(false);
  });

  it.each(["benchmarks/queries/tpch/q1.md", "compat/capability-matrix.md", "reference/tuning-platform-support.md"])("refuses an authored page in the generated scope: %s", (relative) => {
    expect(() => assembleAuthoredDocs(path.join(workDir, "collide"), inputs, authoredTree(`collide-${relative.replaceAll("/", "-")}`, { [relative]: "# Mine\n" }))).toThrow(DocsAssemblyError);
  });

  it("leaves authored pages next to the generated directories alone", () => {
    expect(() => assembleAuthoredDocs(path.join(workDir, "out-near"), inputs, authoredTree("near", { "benchmarks/tpc-h.md": "# H\n", "reference/tuning.md": "# T\n" }))).not.toThrow();
  });

  it("refuses an authored blog directory", () => {
    expect(() => assembleAuthoredDocs(path.join(workDir, "out-blog"), inputs, authoredTree("blog", { "blog/post.md": "# Post\n" }))).toThrow(DocsAssemblyError);
  });

  it("refuses core-only content", () => {
    expect(() => assembleAuthoredDocs(path.join(workDir, "out-core"), inputs, authoredTree("core", { "agent/notes.md": "# Notes\n" }))).toThrow("core-only");
  });

  it("refuses a landing page without the release token", () => {
    expect(() => assembleAuthoredDocs(path.join(workDir, "out-untagged"), inputs, authoredTree("untagged", { "README.md": "Current release: `v1.0.0`.\n" }))).toThrow(DocsAssemblyError);
  });
});
