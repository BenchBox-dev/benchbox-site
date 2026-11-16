import path from "node:path";
import { checkPublishedLlms } from "../src/lib/llms.ts";
import { siteOrigin } from "../src/lib/site-origin.ts";

const siteDir = path.resolve(process.argv[2] ?? "dist");
const problems = checkPublishedLlms(siteDir, siteOrigin());
if (problems.length > 0) {
  process.stderr.write(`${problems.length} problems in llms.txt and the Markdown pages:\n${problems.map((problem) => `  ${problem}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("llms.txt and the Markdown pages: every link resolves\n");
