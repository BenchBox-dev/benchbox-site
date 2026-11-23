import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Manifest } from "./types.ts";

export type InputsKind = "release pin" | "fetched bundle" | "custom inputs";

export const BUNDLE_COMMAND = "npm run bundle:fetch && DOCS_INPUTS=.site-inputs npm run docs:check";

export type Git = (args: string[]) => { ok: boolean; out: string };

export function runGit(repoRoot: string): Git {
  return (args) => {
    try {
      return { ok: true, out: execFileSync("git", args, { cwd: repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim() };
    } catch {
      return { ok: false, out: "" };
    }
  };
}

export function basedOnNext(git: Git): boolean {
  const base = git(["merge-base", "HEAD", "origin/next"]);
  if (!base.ok || base.out === "") return false;
  return !git(["merge-base", "--is-ancestor", base.out, "origin/main"]).ok;
}

export function classifyInputs(inputs: string, repoRoot: string): InputsKind {
  if (inputs === path.resolve(repoRoot, "release-pin")) return "release pin";
  if (inputs === path.resolve(repoRoot, ".site-inputs")) return "fetched bundle";
  return "custom inputs";
}

export function readManifest(inputs: string): Manifest | null {
  try {
    return JSON.parse(readFileSync(path.join(inputs, "manifest.json"), "utf-8")) as Manifest;
  } catch {
    return null;
  }
}

export type DescribeOptions = { inputs: string; repoRoot: string; explicit: boolean; nextBased: boolean; manifest: Manifest | null };

export function describeInputs(options: DescribeOptions): string[] {
  const kind = classifyInputs(options.inputs, options.repoRoot);
  const identity = options.manifest === null ? "no readable manifest" : `version ${options.manifest.package_version}, core commit ${options.manifest.core_sha}`;
  const lines = [`inputs: ${kind} at ${options.inputs} (${identity})`];
  if (!options.explicit && kind === "release pin" && options.nextBased) {
    lines.push("this branch is based on next and DOCS_INPUTS is unset; CI checks next against the newest certified core bundle, not the release pin");
    lines.push(`to reproduce CI's result run: ${BUNDLE_COMMAND}`);
  }
  return lines;
}
