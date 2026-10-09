import { existsSync, readFileSync } from "node:fs";
import { siteInputsPath } from "./site-inputs.ts";

export type RepoFileKind = "file" | "tree";
export type RepoFiles = { coreSha: string; kinds: ReadonlyMap<string, RepoFileKind> };

let cached: RepoFiles | undefined;

export function loadRepoFiles(file: string = siteInputsPath("repo-files.json")): RepoFiles | undefined {
  if (cached) return cached;
  if (!existsSync(file)) return undefined;
  const payload = JSON.parse(readFileSync(file, "utf-8")) as { core_sha: string; files: { path: string; kind: RepoFileKind }[] };
  cached = { coreSha: payload.core_sha, kinds: new Map(payload.files.map((entry) => [entry.path, entry.kind])) };
  return cached;
}

export function resetRepoFiles(): void {
  cached = undefined;
}
