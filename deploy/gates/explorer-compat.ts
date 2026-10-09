import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { filesUnder } from "./files.ts";
import { fail, pass, type GateResult } from "./types.ts";

export type VersionPair = { name: string; ui: number; snapshot: number; ok: boolean };

export function uiVersionFromSource(source: string): number {
  const matches = [...source.matchAll(/^const EXPECTED_READ_MODEL_VERSION\s*=\s*(\d+);/gm)];
  if (matches.length !== 1) throw new Error(`expected exactly one EXPECTED_READ_MODEL_VERSION constant, found ${matches.length}`);
  return Number(matches[0][1]);
}

export function requiredPairs(input: {
  mode: "deploy" | "redeploy" | "rollback";
  candidate: { ui: number; snapshot: number };
  deployed: { ui: number; snapshot: number } | null;
}): VersionPair[] {
  const pair = (name: string, ui: number, snapshot: number): VersionPair => ({ name, ui, snapshot, ok: snapshot >= ui });
  const pairs = [pair("candidate-ui/candidate-snapshot", input.candidate.ui, input.candidate.snapshot)];
  if (input.deployed) {
    pairs.push(pair("deployed-ui/candidate-snapshot", input.deployed.ui, input.candidate.snapshot));
  }
  return pairs;
}

export function artifactErrors(explorerDir: string): string[] {
  const index = path.join(explorerDir, "index.html");
  if (!existsSync(index)) return ["results/index.html is missing"];
  const errors: string[] = [];
  const html = readFileSync(index, "utf8").toLowerCase();
  if (html.trim() === "" || !(html.includes("<html") || html.includes("<!doctype html"))) errors.push("results/index.html is not an HTML document");
  const files = filesUnder(explorerDir);
  if (!files.some((file) => file.endsWith(".js"))) errors.push("the Explorer artifact has no JavaScript");
  if (!files.some((file) => file.endsWith(".css"))) errors.push("the Explorer artifact has no stylesheet");
  for (const file of files) {
    if (!file.endsWith(".gitkeep") && statSync(path.join(explorerDir, file)).size === 0) errors.push(`results/${file} is empty`);
  }
  return errors;
}

export function explorerCompatGate(input: {
  siteDir: string;
  mode: "deploy" | "redeploy" | "rollback";
  uiVersion: number;
  snapshotVersion: number;
  deployed: { ui: number; snapshot: number } | null;
}): GateResult {
  const errors = artifactErrors(path.join(input.siteDir, "results"));
  const pairs = requiredPairs({ mode: input.mode, candidate: { ui: input.uiVersion, snapshot: input.snapshotVersion }, deployed: input.deployed });
  const older = pairs.filter((entry) => !entry.ok).map((entry) => entry.name);
  if (older.length > 0) errors.push(`snapshot older than UI for: ${older.join(", ")}`);
  if (errors.length > 0) return { ...fail(errors[0], errors), pairs } as GateResult;
  return { ...pass("the Explorer artifact is complete and every required pair has snapshot >= ui"), pairs } as GateResult;
}
