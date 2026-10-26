import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { listDocSources } from "../../website/src/converter/sources.ts";
import { boundaryViolations } from "../checks/boundary.ts";
import { commandViolations, mcpViolations } from "../checks/commands.ts";
import { consistencyViolations } from "../checks/consistency.ts";
import { countViolations } from "../checks/counts.ts";
import { optionViolations } from "../checks/options.ts";
import { pageViolations } from "../checks/pages.ts";
import type { Context, Contracts, Manifest, Page, Violation } from "./types.ts";

export type Mode = "report" | "block";

export type Options = { inputs: string; docs?: string; mode: Mode; allowSchema3: boolean };

export type Outcome = { blocking: Violation[]; reported: Violation[]; notes: string[] };

export function readPages(docsRoot: string): Page[] {
  return listDocSources(docsRoot, ".md").map((source) => ({ path: source.relative, text: readFileSync(source.absolute, "utf-8") }));
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
  ];
}

export function runChecks(options: Options): Outcome {
  const manifestFile = path.join(options.inputs, "manifest.json");
  if (!existsSync(manifestFile)) throw new Error(`core bundle is missing at ${options.inputs}; run npm run bundle:fetch or set SITE_INPUTS`);
  const manifest = JSON.parse(readFileSync(manifestFile, "utf-8")) as Manifest;
  const outcome: Outcome = { blocking: [], reported: [], notes: [] };
  const docsFailures = options.mode === "block" ? outcome.blocking : outcome.reported;
  const docsRoot = options.docs ?? path.join(options.inputs, "docs");
  const contractsFile = path.join(options.inputs, "doc-contracts.json");

  let contracts: Contracts | null = null;
  if (existsSync(contractsFile)) {
    contracts = JSON.parse(readFileSync(contractsFile, "utf-8")) as Contracts;
  } else if (manifest.schema === 3 && options.allowSchema3) {
    outcome.notes.push("schema 3 bundle carries no doc-contracts.json; contract checks are skipped and only the schema-independent publication boundary runs");
  } else {
    outcome.blocking.push({ check: "contracts-present", page: "doc-contracts.json", invariant: `schema ${manifest.schema} bundle has no doc-contracts.json` });
  }

  if (!existsSync(docsRoot)) {
    outcome.blocking.push({ check: "docs-present", page: docsRoot, invariant: "no documentation tree to check; pass --docs for a bundle without a docs member" });
    return outcome;
  }
  const pages = readPages(docsRoot);
  if (contracts === null) {
    docsFailures.push(...boundaryViolations({ pages, contracts: null }));
    return outcome;
  }
  const ctx: Context = { manifest, contracts, pages };
  outcome.blocking.push(...guarded("contract-consistency", () => consistencyViolations(ctx)));
  docsFailures.push(...docsChecks(ctx));
  return outcome;
}
