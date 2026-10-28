import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { assertNoCoreOnlyContent, CoreOnlyContentError, coreOnlyReason, listDocSources, RENDERER_ROOTS, walkDocFiles } from "../src/converter/sources.ts";
import { repoPath } from "../src/lib/site-inputs.ts";

const workDir = mkdtempSync(path.join(os.tmpdir(), "sources-"));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

function tree(name: string, files: string[]): string {
  const root = path.join(workDir, name);
  for (const relative of files) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), "# Page\n");
  }
  return root;
}

describe("core-only classification", () => {
  it.each([
    "agent/README.md",
    "internal/adr/adr-site-docs-ownership.md",
    ["_project", "notes.md"].join("/"),
    "design/future-state/index.md",
    "design/future-state/contract-index.md",
    "reference/threat-model.md",
    "platforms/workaround-index.md",
    "tpc-licensing-analysis.md",
    "publish-allowlist.txt",
    "publish-exclusions.txt",
    "operations/local-platform-provisioning.tsv",
  ])("rejects %s", (relative) => {
    expect(coreOnlyReason(relative)).not.toBeNull();
  });

  it.each(["README.md", "agent.md", "design/index.md", "design/architecture.md", "usage/agent/page.md", "guides/internal.md", "platforms/index.md", "development/adr/README.md"])("allows %s", (relative) => {
    expect(coreOnlyReason(relative)).toBeNull();
  });
});

describe("documentation sources", () => {
  it("lists Markdown pages, skipping renderer roots and working directories", () => {
    const docsRoot = tree("md", ["kept.md", ...[...RENDERER_ROOTS].map((root) => `${root}/page.md`), "sub/_sources/z.md", "sub/.#lock.md", "sub/macOS.lproj/z.md", "sub/page.md", "sub/notes.txt"]);
    expect(listDocSources(docsRoot).map((source) => source.relative)).toEqual(["kept.md", "sub/page.md"]);
  });

  it("lists reStructuredText pages under the same rules", () => {
    const docsRoot = tree("rst", ["kept.rst", "_static/y.rst", "sub/_sources/z.rst", "sub/page.rst", "kept.md"]);
    expect(listDocSources(docsRoot, ".rst").map((source) => source.relative)).toEqual(["kept.rst", "sub/page.rst"]);
  });

  it("refuses a tree that holds core-only content", () => {
    const docsRoot = tree("core-only", ["index.md", "agent/notes.md", "publish-exclusions.txt", "reference/threat-model.md"]);
    const failure = (() => {
      try {
        listDocSources(docsRoot);
      } catch (error) {
        return error;
      }
      return null;
    })();
    expect(failure).toBeInstanceOf(CoreOnlyContentError);
    expect((failure as CoreOnlyContentError).violations.map((entry) => entry.split(":")[0])).toEqual(["agent/notes.md", "publish-exclusions.txt", "reference/threat-model.md"]);
  });

  it("refuses core-only content of any file type, not only Markdown", () => {
    expect(() => assertNoCoreOnlyContent(walkDocFiles(tree("tsv", ["operations/local-platform-provisioning.tsv"])))).toThrow(CoreOnlyContentError);
  });

  it("holds no core-only content in the site's own documentation tree", () => {
    expect(() => assertNoCoreOnlyContent(walkDocFiles(repoPath("docs")))).not.toThrow();
  });
});
