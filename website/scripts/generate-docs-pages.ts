import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDocsData } from "../src/lib/docs-generators/docs-data.ts";
import { generateDocsPages } from "../src/lib/docs-generators/generate.ts";
import { siteInputsPath } from "../src/lib/site-inputs.ts";

const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] !== undefined && !process.argv[at + 1].startsWith("--") ? process.argv[at + 1] : fallback;
}

const docsDataFile = path.resolve(option("--docs-data", siteInputsPath("docs-data", "docs-data.json")));
const outRoot = path.resolve(option("--out", path.join(websiteRoot, ".generated", "docs-pages")));

const data = loadDocsData(docsDataFile);
const files = generateDocsPages(data);

rmSync(outRoot, { recursive: true, force: true });
for (const [relative, content] of [...files.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
  const target = path.join(outRoot, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}
process.stdout.write(`wrote ${files.size} pages to ${path.relative(process.cwd(), outRoot) || outRoot}\n`);
