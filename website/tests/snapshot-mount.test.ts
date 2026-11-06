import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertMountedSnapshotMatchesBundle, MOUNTED_SNAPSHOT } from "../src/lib/snapshot-mount.ts";

describe("mounted snapshot guard", () => {
  let root: string;
  let previous: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "snapshot-mount-"));
    previous = process.env.SITE_INPUTS;
    process.env.SITE_INPUTS = path.join(root, "inputs");
    mkdirSync(path.join(root, "inputs", "explorer"), { recursive: true });
    mkdirSync(path.dirname(path.join(root, "out", MOUNTED_SNAPSHOT)), { recursive: true });
    writeFileSync(path.join(root, "inputs", "manifest.json"), "{}");
    writeFileSync(path.join(root, "inputs", "explorer", "results.duckdb"), "snapshot-a");
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.SITE_INPUTS;
    else process.env.SITE_INPUTS = previous;
    rmSync(root, { recursive: true, force: true });
  });

  it("accepts the snapshot the pages were generated from", () => {
    writeFileSync(path.join(root, "out", MOUNTED_SNAPSHOT), "snapshot-a");
    expect(() => assertMountedSnapshotMatchesBundle(path.join(root, "out"))).not.toThrow();
  });

  it("rejects an Explorer that serves a different snapshot", () => {
    writeFileSync(path.join(root, "out", MOUNTED_SNAPSHOT), "snapshot-b");
    expect(() => assertMountedSnapshotMatchesBundle(path.join(root, "out"))).toThrow(/serves snapshot/);
  });
});
