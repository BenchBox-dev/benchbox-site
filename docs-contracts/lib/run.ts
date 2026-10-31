import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { walkDocFiles } from "../../website/src/converter/sources.ts";
import { assembleAuthoredDocs } from "../../website/src/lib/site-inputs.ts";
import { boundaryViolations } from "../checks/boundary.ts";
import { commandViolations, mcpViolations } from "../checks/commands.ts";
import { consistencyViolations } from "../checks/consistency.ts";
import { countViolations } from "../checks/counts.ts";
import { optionViolations } from "../checks/options.ts";
import { pageViolations } from "../checks/pages.ts";
import { sourceReferenceViolations } from "../checks/sources.ts";
import type { Context, Contracts, Manifest, Page, Violation } from "./types.ts";

export type Mode = "report" | "block";

export type Options = { inputs: string; docs?: string; mode: Mode };

export type Outcome = { blocking: Violation[]; reported: Violation[]; notes: string[] };

export function readPages(docsRoot: string): Page[] {
  return walkDocFiles(docsRoot)
    .filter((source) => source.relative.endsWith(".md"))
    .map((source) => ({ path: source.relative, text: readFileSync(source.absolute, "utf-8") }));
}

function guarded(name: string, run: () => Violation[]): Violation[] {
  try {
    return run();
  } catch (error) {
    return [{ check: name, page: "doc-contracts.json", invariant: `check could not run against the exported contracts: ${(error as Error).message}` }];
  }
}

export function docsChecks(ctx: Context): Violation[] {
  return [
    ...guarded("publication-boundary", () => boundaryViolations({ pages: ctx.pages, contracts: ctx.contracts })),
    ...guarded("counts", () => countViolations(ctx)),
    ...guarded("platform-option-examples", () => optionViolations(ctx)),
    ...guarded("commands", () => commandViolations(ctx)),
    ...guarded("mcp", () => mcpViolations(ctx)),
    ...guarded("pages", () => pageViolations(ctx)),
    ...guarded("user-page-sources", () => sourceReferenceViolations(ctx)),
  ];
}

export function runChecks(options: Options): Outcome {
  const manifestFile = path.join(options.inputs, "manifest.json");
  if (!existsSync(manifestFile)) throw new Error(`core bundle is missing at ${options.inputs}; run npm run bundle:fetch or set SITE_INPUTS`);
  const manifest = JSON.parse(readFileSync(manifestFile, "utf-8")) as Manifest;
  const outcome: Outcome = { blocking: [], reported: [], notes: [] };
  const docsFailures = options.mode === "block" ? outcome.blocking : outcome.reported;
  const contractsFile = path.join(options.inputs, "doc-contracts.json");
  if (!existsSync(contractsFile)) {
    outcome.blocking.push({ check: "contracts-present", page: "doc-contracts.json", invariant: `schema ${manifest.schema} bundle has no doc-contracts.json` });
    return outcome;
  }
  const contracts = JSON.parse(readFileSync(contractsFile, "utf-8")) as Contracts;

  const scratch = options.docs === undefined ? mkdtempSync(path.join(os.tmpdir(), "benchbox-docs-check-")) : null;
  try {
    const docsRoot = options.docs ?? assembleAuthoredDocs(scratch as string, options.inputs);
    if (!existsSync(docsRoot)) {
      outcome.blocking.push({ check: "docs-present", page: docsRoot, invariant: "no documentation tree to check" });
      return outcome;
    }
    const ctx: Context = { manifest, contracts, pages: readPages(docsRoot) };
    outcome.blocking.push(...guarded("contract-consistency", () => consistencyViolations(ctx)));
    docsFailures.push(...docsChecks(ctx));
    return outcome;
  } finally {
    if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
  }
}
