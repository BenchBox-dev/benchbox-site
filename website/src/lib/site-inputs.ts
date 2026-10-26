import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNoCoreOnlyContent, walkDocFiles } from "../converter/sources.ts";
import { loadDocsData } from "./docs-generators/docs-data.ts";
import { generateDocsPages, inGeneratedScope } from "./docs-generators/generate.ts";

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

export const LANDING_VERSION_TOKEN = "{{package_version}}";
const LANDING_PAGE = "README.md";

export class DocsAssemblyError extends Error {
  constructor(problems: readonly string[]) {
    super(`documentation assembly failed:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
    this.name = "DocsAssemblyError";
  }
}

export function assembleAuthoredDocs(destination: string, inputs: string = requireSiteInputs(), authored: string = repoPath("docs")): string {
  const docsRoot = path.join(destination, "docs");
  const files = walkDocFiles(authored);
  assertNoCoreOnlyContent(files);
  const collisions = files.filter((file) => inGeneratedScope(file.relative) || file.relative === "blog" || file.relative.startsWith("blog/"));
  if (collisions.length > 0) {
    throw new DocsAssemblyError(collisions.map((file) => `${file.relative}: authored page lies in the generated or blog scope`));
  }
  const manifest = JSON.parse(readFileSync(path.join(inputs, "manifest.json"), "utf-8")) as BundleManifest;
  const landing = readFileSync(path.join(authored, LANDING_PAGE), "utf-8");
  if (!landing.includes(LANDING_VERSION_TOKEN)) {
    throw new DocsAssemblyError([`${LANDING_PAGE}: the release token ${LANDING_VERSION_TOKEN} is missing`]);
  }
  const generated = generateDocsPages(loadDocsData(path.join(inputs, "docs-data", "docs-data.json")));
  const strays = [...generated.keys()].filter((relative) => !inGeneratedScope(relative));
  if (strays.length > 0) throw new DocsAssemblyError(strays.map((relative) => `${relative}: generated page lies outside the generated scope`));
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  cpSync(authored, docsRoot, { recursive: true });
  writeFileSync(path.join(docsRoot, LANDING_PAGE), landing.replaceAll(LANDING_VERSION_TOKEN, manifest.package_version));
  for (const [relative, content] of generated) {
    const target = path.join(docsRoot, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return docsRoot;
}

export function assembleDocsSource(destination: string): string {
  const inputs = requireSiteInputs();
  const docsRoot = assembleAuthoredDocs(destination, inputs);
  cpSync(repoPath("blog"), path.join(docsRoot, "blog"), { recursive: true });
  cpSync(path.join(inputs, "repo-files.json"), path.join(destination, "repo-files.json"));
  return docsRoot;
}
