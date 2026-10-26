import path from "node:path";
import { parseArgs } from "node:util";
import { runChecks, type Mode } from "./lib/run.ts";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const { values } = parseArgs({
  options: {
    inputs: { type: "string" },
    docs: { type: "string" },
    "docs-mode": { type: "string", default: "block" },
    "allow-schema3": { type: "boolean", default: false },
  },
});

const mode = values["docs-mode"];
if (mode !== "report" && mode !== "block") {
  console.error(`docs-contracts: --docs-mode must be report or block, got ${mode}`);
  process.exit(2);
}

let outcome;
try {
  outcome = runChecks({
    inputs: path.resolve(values.inputs ?? process.env.SITE_INPUTS ?? path.join(ROOT, ".site-inputs")),
    docs: values.docs === undefined ? undefined : path.resolve(values.docs),
    mode: mode as Mode,
    allowSchema3: values["allow-schema3"] === true,
  });
} catch (error) {
  console.error(`docs-contracts: ${(error as Error).message}`);
  process.exit(2);
}

for (const note of outcome.notes) console.log(`docs-contracts: ${note}`);
for (const violation of outcome.reported) console.warn(`docs-contracts: report-only [${violation.check}] ${violation.page}: ${violation.invariant}`);
for (const violation of outcome.blocking) console.error(`docs-contracts: [${violation.check}] ${violation.page}: ${violation.invariant}`);
if (outcome.blocking.length > 0) {
  console.error(`docs-contracts: ${outcome.blocking.length} blocking violation(s), ${outcome.reported.length} report-only`);
  process.exit(1);
}
console.log(`docs-contracts: ok (${outcome.reported.length} report-only violation(s), mode ${mode})`);
