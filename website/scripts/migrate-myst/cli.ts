import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { emptyInventory, scanFile, type Inventory } from "../../src/converter/inventory.ts";
import { listDocSources, walkDocFiles } from "../../src/converter/sources.ts";
import { repoPath } from "../../src/lib/site-inputs.ts";
import { buildContext, splitFrontMatter, type Snapshot } from "./context.ts";
import { mergeFrontMatter } from "./front-matter.ts";
import { rewriteInline } from "./inline.ts";
import { navFile } from "./nav-file.ts";
import { rewriteStructure, type Findings } from "./structure.ts";

const BLOG_INDEX = `<span id="id1"></span>

# Blog

The BenchBox blog features benchmarking insights, performance analysis, and updates about the project.
`;

const DISABLE_BLOCKQUOTE_BLANK = "<!-- markdownlint-disable MD028 -->";

const TAGS_DIRECTIVE = /^`{3,}\{tags\}/m;

function migrate(snapshotPath: string): void {
  const context = buildContext();
  writeFileSync(snapshotPath, `${JSON.stringify(context.snapshot)}\n`);
  const findings: Findings = { droppedToctrees: [], flattened: [], kept: [] };
  let changed = 0;
  for (const file of walkDocFiles(repoPath("docs")).filter((entry) => entry.relative.endsWith(".md"))) {
    const raw = readFileSync(file.absolute, "utf-8");
    const { front, body } = splitFrontMatter(raw);
    const info = context.infos.get(file.relative);
    if (!info) throw new Error(`${file.relative} is not a built page`);
    const tags = TAGS_DIRECTIVE.test(body.join("\n")) ? info.tags : [];
    const merged = mergeFrontMatter(file.relative, front, tags);
    const rewritten = rewriteInline(file.relative, rewriteStructure(file.relative, body, context, merged.definitionLists, findings), context);
    const head = merged.front.length > 0 ? `---\n${merged.front.join("\n")}\n---\n\n` : "";
    const adjacentAlerts = rewritten.some((line, position) => line === "" && rewritten[position - 1]?.startsWith(">") && rewritten[position + 1]?.startsWith("> [!"));
    const lint = adjacentAlerts && !rewritten.includes(DISABLE_BLOCKQUOTE_BLANK) ? [DISABLE_BLOCKQUOTE_BLANK, ""] : [];
    const text = `${head}${[...lint, ...rewritten].join("\n")}\n`;
    if (text !== raw) {
      writeFileSync(file.absolute, text);
      changed += 1;
    }
  }
  writeFileSync(repoPath("blog", "index.md"), BLOG_INDEX);
  writeFileSync(repoPath("docs", "nav.yml"), navFile(context));
  process.stdout.write(`rewrote ${changed} documentation pages, blog/index.md and docs/nav.yml\n`);
  process.stdout.write(`toctree blocks dropped as redundant: ${findings.droppedToctrees.join(", ") || "none"}\n`);
  process.stdout.write(`toctree blocks with maxdepth 2 flattened: ${findings.flattened.join(", ") || "none"}\n`);
}

function constructCount(inventory: Inventory): number {
  const sum = (counter: Map<string, number>): number => [...counter.values()].reduce((total, value) => total + value, 0);
  return sum(inventory.directives) + sum(inventory.roles) + inventory.labels + inventory.comments + sum(inventory.mystKeys) + sum(inventory.enabledExtensions);
}

function compare(snapshotPath: string): number {
  const before = JSON.parse(readFileSync(snapshotPath, "utf-8")) as Snapshot;
  const after = buildContext().snapshot;
  let failures = 0;
  const report = (ok: boolean, label: string): void => {
    process.stdout.write(`${ok ? "identical" : "DIFFERENT"}: ${label}\n`);
    if (!ok) failures += 1;
  };
  report(before.sidebar === after.sidebar, "manifest/sidebar.json");
  report(before.tags === after.tags, "manifest/tags.json");
  const lost: string[] = [];
  const gained: string[] = [];
  for (const [page, ids] of Object.entries(before.ids)) {
    const remaining = new Set(after.ids[page] ?? []);
    const existing = new Set(ids);
    for (const id of ids) if (!remaining.has(id)) lost.push(`${page}#${id}`);
    for (const id of remaining) if (!existing.has(id)) gained.push(`${page}#${id}`);
  }
  for (const page of Object.keys(after.ids)) if (!(page in before.ids)) process.stdout.write(`new page: ${page}\n`);
  for (const page of Object.keys(before.ids)) if (!(page in after.ids)) process.stdout.write(`removed page: ${page}\n`);
  const automatic = /#id\d+$/;
  process.stdout.write(`ids lost, automatic: ${lost.filter((id) => automatic.test(id)).length}; named: ${lost.filter((id) => !automatic.test(id)).length}\n`);
  process.stdout.write(`ids gained, automatic: ${gained.filter((id) => automatic.test(id)).length}; named: ${gained.filter((id) => !automatic.test(id)).length}\n`);
  for (const id of lost.filter((entry) => !automatic.test(entry))) process.stdout.write(`lost ${id}\n`);
  for (const id of gained.filter((entry) => !automatic.test(entry))) process.stdout.write(`gained ${id}\n`);
  for (const id of lost.filter((entry) => automatic.test(entry))) process.stdout.write(`lost-auto ${id}\n`);
  for (const id of gained.filter((entry) => automatic.test(entry))) process.stdout.write(`gained-auto ${id}\n`);
  return failures;
}

function inventory(): number {
  const root = repoPath("docs");
  const found = emptyInventory();
  for (const source of listDocSources(root)) scanFile(found, source.relative, readFileSync(source.absolute, "utf-8"));
  const blog = repoPath("blog");
  for (const source of listDocSources(blog)) scanFile(found, path.posix.join("blog", source.relative), readFileSync(source.absolute, "utf-8"));
  const count = constructCount(found);
  process.stdout.write(`MyST constructs left in docs/ and blog/: ${count}\n`);
  return count === 0 ? 0 : 1;
}

const [command, argument] = process.argv.slice(2);
if (command === "migrate" && argument) migrate(argument);
else if (command === "compare" && argument) process.exit(compare(argument) === 0 ? 0 : 1);
else if (command === "inventory") process.exit(inventory());
else {
  process.stderr.write("usage: migrate-myst.ts migrate <snapshot.json> | compare <snapshot.json> | inventory\n");
  process.exit(2);
}
