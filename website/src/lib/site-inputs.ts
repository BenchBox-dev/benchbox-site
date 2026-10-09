import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export { DEFAULT_SITE_ORIGIN, siteHost, siteOrigin } from "./site-origin.ts";

function findRepoRoot(start: string): string {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, "website", "package.json")) && existsSync(path.join(dir, "explorer", "package.json"))) return dir;
    if (path.dirname(dir) === dir) return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  }
}

export const REPO_ROOT = path.resolve(process.env.SITE_REPO_ROOT ?? findRepoRoot(process.cwd()));

export type BundleManifest = {
  schema: number;
  core_sha: string;
  package_version: string;
  corpus_sha: string;
  parent_core_sha: string;
  certified_by: string;
};

export function siteInputsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.SITE_INPUTS ?? path.join(REPO_ROOT, ".site-inputs"));
}

export function siteInputsPath(...parts: string[]): string {
  return path.join(siteInputsRoot(), ...parts);
}

export function requireSiteInputs(): string {
  const root = siteInputsRoot();
  if (!existsSync(path.join(root, "manifest.json"))) {
    throw new Error(`Core bundle is missing at ${root}. Run npm run bundle:fetch, or set SITE_INPUTS.`);
  }
  return root;
}

export function bundleManifest(): BundleManifest {
  return JSON.parse(readFileSync(path.join(requireSiteInputs(), "manifest.json"), "utf-8")) as BundleManifest;
}

export function repoPath(...parts: string[]): string {
  return path.join(REPO_ROOT, ...parts);
}

export function assembleDocsSource(destination: string): string {
  const inputs = requireSiteInputs();
  const docsRoot = path.join(destination, "docs");
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  const downloads = path.join(inputs, "downloads");
  if (existsSync(downloads)) cpSync(downloads, destination, { recursive: true });
  cpSync(path.join(inputs, "docs"), docsRoot, { recursive: true });
  cpSync(repoPath("blog"), path.join(docsRoot, "blog"), { recursive: true });
  return docsRoot;
}
