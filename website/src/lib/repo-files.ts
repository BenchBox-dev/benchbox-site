import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const REPO_FILES_NAME = "repo-files.json";

export type RepoFileKind = "file" | "tree";
export type RepoFiles = { coreSha: string; kinds: ReadonlyMap<string, RepoFileKind> };

const cache = new Map<string, RepoFiles | undefined>();

export function repoFilesFor(docsRoot: string): RepoFiles | undefined {
  const file = path.join(path.dirname(docsRoot), REPO_FILES_NAME);
  if (cache.has(file)) return cache.get(file);
  let loaded: RepoFiles | undefined;
  if (existsSync(file)) {
    const payload = JSON.parse(readFileSync(file, "utf-8")) as { core_sha: string; files: { path: string; kind: RepoFileKind }[] };
    loaded = { coreSha: payload.core_sha, kinds: new Map(payload.files.map((entry) => [entry.path, entry.kind])) };
  }
  cache.set(file, loaded);
  return loaded;
}
