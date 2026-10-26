import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { formatParityReport, runParity } from "../src/lib/docs-generators/parity.ts";
import { siteInputsRoot } from "../src/lib/site-inputs.ts";

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  const value = process.argv[at + 1];
  return at >= 0 && value !== undefined && !value.startsWith("--") ? value : undefined;
}

const bundleDir = path.resolve(option("--bundle") ?? siteInputsRoot());
const reportFile = option("--report");
const requireApplicable = process.argv.includes("--require-applicable");

const result = runParity(bundleDir);
if (result.status === "not-applicable") {
  process.stdout.write(`docs parity not applicable: ${result.message}\n`);
  process.exit(requireApplicable ? 1 : 0);
}

const { identity, report } = result;
process.stdout.write(`docs parity against bundle schema ${identity.schema}, core ${identity.coreSha}, docs-data sha256 ${identity.docsDataSha256}\n`);
process.stdout.write(`${formatParityReport(report)}\n`);
if (reportFile) {
  mkdirSync(path.dirname(path.resolve(reportFile)), { recursive: true });
  writeFileSync(
    reportFile,
    `${JSON.stringify({ status: result.status, identity, report, generatedInventory: result.generatedInventory, bundledInventory: result.bundledInventory }, null, 2)}\n`,
  );
}
if (result.status === "fail") {
  process.stderr.write("docs parity FAILED: generated documentation differs from the bundled documentation\n");
  process.exit(1);
}
process.stdout.write("docs parity OK\n");
