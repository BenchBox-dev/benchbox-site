import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkPublishedLlms } from "../src/lib/llms.ts";
import { siteOrigin } from "../src/lib/site-origin.ts";

const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteDir = path.resolve(process.argv[2] ?? "dist");
const generated = path.join(websiteRoot, ".generated");
const markdownRoot = path.join(generated, "markdown", "docs");
const llms = path.join(generated, "manifest", "llms.txt");

if (!existsSync(markdownRoot) || !existsSync(llms)) {
  process.stderr.write(`the converter output has no Markdown pages or llms.txt under ${generated}; run npm run convert first\n`);
  process.exit(1);
}

cpSync(markdownRoot, path.join(siteDir, "docs"), { recursive: true });
cpSync(llms, path.join(siteDir, "llms.txt"));

const problems = checkPublishedLlms(siteDir, siteOrigin());
if (problems.length > 0) {
  process.stderr.write(`${problems.length} problems in llms.txt and the Markdown pages:\n${problems.map((problem) => `  ${problem}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`published llms.txt and the Markdown pages; every link resolves in ${path.relative(process.cwd(), siteDir) || "."}\n`);
