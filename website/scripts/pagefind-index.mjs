import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pagefind from "pagefind";

export const SEARCH_SECTIONS = [
  { name: "Docs", dir: "docs" },
  { name: "Blog", dir: "blog" },
  { name: "Results", dir: "result-summaries/platforms" },
  { name: "Results", dir: "result-summaries/benchmarks" },
];

function* htmlFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(full);
    else if (entry.name.endsWith(".html")) yield full;
  }
}

export function inSection(content, name) {
  const filter = `data-pagefind-filter="section:${name}"`;
  const withoutExisting = content.replace(/\sdata-pagefind-filter="section:[^"]*"/g, "");
  if (/\sdata-pagefind-body\b/.test(withoutExisting)) return withoutExisting.replace(/(\sdata-pagefind-body\b(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)/, `$1 ${filter}`);
  return withoutExisting.replace(/<body\b/, `<body ${filter}`);
}

export async function indexSite(site, sections = SEARCH_SECTIONS) {
  const { index, errors: createErrors } = await pagefind.createIndex();
  if (!index) throw new Error(`pagefind createIndex failed: ${createErrors.join("; ")}`);

  const urls = [];
  for (const section of sections) {
    const root = path.join(site, section.dir);
    for (const file of htmlFiles(root)) {
      const url = `/${path.relative(site, file).split(path.sep).join("/")}`;
      const content = readFileSync(file, "utf-8");
      if (/http-equiv="refresh"/i.test(content)) continue;
      const { errors } = await index.addHTMLFile({ sourcePath: path.relative(site, file), url, content: inSection(content, section.name) });
      if (errors.length > 0) throw new Error(`pagefind failed on ${url}: ${errors.join("; ")}`);
      urls.push(url);
    }
  }

  return { index, urls };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const site = path.resolve(process.argv[2] ?? "dist");
  const { index, urls } = await indexSite(site);
  const { errors } = await index.writeFiles({ outputPath: path.join(site, "pagefind") });
  if (errors.length > 0) throw new Error(`pagefind write failed: ${errors.join("; ")}`);
  await pagefind.close();
  console.log(`pagefind indexed ${urls.length} pages`);
}
