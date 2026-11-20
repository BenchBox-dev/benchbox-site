import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assembleAuthoredDocs, docsInputsRoot } from "../src/lib/site-inputs.ts";

const scratch = mkdtempSync(path.join(os.tmpdir(), "benchbox-docs-assemble-"));
try {
  const inputs = docsInputsRoot();
  assembleAuthoredDocs(scratch, inputs);
  process.stdout.write(`assembled the authored docs against ${path.relative(process.cwd(), inputs) || inputs}\n`);
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
