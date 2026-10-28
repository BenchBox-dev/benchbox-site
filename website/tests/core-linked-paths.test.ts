import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectCoreLinkedPaths, formatCoreLinkedPaths, isFresh } from "../src/lib/core-linked-paths.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const REPO_FILES = {
  core_sha: "0123456789abcdef0123456789abcdef01234567",
  files: [
    { path: "benchbox/core/queries.py", kind: "file" },
    { path: "benchbox/sql_compat", kind: "tree" },
    { path: "examples/run.py", kind: "file" },
    { path: "examples/unified", kind: "tree" },
  ],
};

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "benchbox-core-links-"));
  roots.push(root);
  const all: Record<string, string> = { "repo-files.json": JSON.stringify(REPO_FILES), ...files };
  for (const [relative, content] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), content);
  }
  return path.join(root, "docs");
}

const sourceOf = (file: string): string | undefined => (file === "generated.md" ? undefined : file.startsWith("blog/") ? file : `docs/${file}`);

const BASE = {
  "docs/a.md": "# A\n\n[Run](../examples/run.py#L3) and [again](../examples/run.py)\n\n[Pkg](../benchbox/sql_compat/)\n",
  "docs/guide/b.md": "# B\n\nText\n\n[Run](../../examples/run.py)\n[Page](../a.md)\n[Out](https://github.com/BenchBox-dev/BenchBox/blob/abc/examples/run.py)\n",
  "docs/generated.md": "# Generated\n\n[Q](../benchbox/core/queries.py)\n",
  "docs/blog/post.md": "# Post\n\n[Dir](../../examples/unified/)\n",
};

describe("core-linked paths inventory", () => {
  it("lists each core path with its kind and sorted sources", () => {
    const inventory = collectCoreLinkedPaths({ docsRoot: tree(BASE), sourceOf });
    expect(formatCoreLinkedPaths(inventory)).toBe(
      `${JSON.stringify(
        {
          paths: [
            { path: "benchbox/sql_compat", kind: "directory", sources: ["docs/a.md:5"] },
            { path: "examples/run.py", kind: "file", sources: ["docs/a.md:3", "docs/guide/b.md:5"] },
            { path: "examples/unified", kind: "directory", sources: ["blog/post.md:3"] },
          ],
        },
        null,
        2,
      )}\n`,
    );
  });

  it("fails the freshness check when a link to a core path is added until regenerated", () => {
    const committed = formatCoreLinkedPaths(collectCoreLinkedPaths({ docsRoot: tree(BASE), sourceOf }));
    const unchanged = collectCoreLinkedPaths({ docsRoot: tree(BASE), sourceOf });
    expect(isFresh(committed, unchanged)).toBe(true);
    const edited = collectCoreLinkedPaths({ docsRoot: tree({ ...BASE, "docs/c.md": "# C\n\n[Q](../benchbox/core/queries.py)\n" }), sourceOf });
    expect(isFresh(committed, edited)).toBe(false);
    expect(edited.paths.map((entry) => entry.path)).toContain("benchbox/core/queries.py");
    expect(isFresh(formatCoreLinkedPaths(edited), edited)).toBe(true);
  });

  it("fails when a link does not resolve to a core path", () => {
    expect(() => collectCoreLinkedPaths({ docsRoot: tree({ "docs/a.md": "# A\n\n[Gone](../nowhere.py)\n" }), sourceOf })).toThrow("conversion failed");
  });
});
