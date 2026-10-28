import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadKnownBrokenLinks } from "../src/converter/build.ts";
import { ConversionFailedError } from "../src/converter/errors.ts";
import { collectCoreLinkedPaths, type CoreLinkedPaths, formatCoreLinkedPaths, isFresh } from "../src/lib/core-linked-paths.ts";
import { assembleDocsSource, repoPath } from "../src/lib/site-inputs.ts";

const INVENTORY = repoPath("inventory", "core-linked-paths.json");

function sourceOf(file: string): string | undefined {
  if (file.startsWith("blog/")) return existsSync(repoPath(file)) ? file : undefined;
  return existsSync(repoPath("docs", file)) ? `docs/${file}` : undefined;
}

const scratch = mkdtempSync(path.join(os.tmpdir(), "benchbox-core-links-"));
let inventory: CoreLinkedPaths;
try {
  const docsRoot = assembleDocsSource(scratch);
  const knownBrokenLinks = loadKnownBrokenLinks(repoPath("inventory", "known-broken-links.json"));
  inventory = collectCoreLinkedPaths({ docsRoot, sourceOf, knownBrokenLinks });
} catch (error) {
  if (!(error instanceof ConversionFailedError)) throw error;
  process.stderr.write(`${error.errors.map((failure) => failure.message).join("\n")}\n`);
  process.exit(1);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (process.argv.includes("--check")) {
  const committed = existsSync(INVENTORY) ? readFileSync(INVENTORY, "utf-8") : "";
  if (!isFresh(committed, inventory)) {
    process.stderr.write("inventory/core-linked-paths.json is stale; run `npm run inventory:core-links -w website` and commit the result\n");
    process.exit(1);
  }
  process.stdout.write("core-linked paths inventory is fresh\n");
} else {
  writeFileSync(INVENTORY, formatCoreLinkedPaths(inventory));
  process.stdout.write(`wrote ${path.relative(process.cwd(), INVENTORY)}\n`);
}
