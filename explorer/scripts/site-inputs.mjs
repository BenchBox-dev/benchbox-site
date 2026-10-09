import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const explorerRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
export const repoRoot = resolve(explorerRoot, "..");

export function siteInputsRoot(env = process.env) {
  return resolve(env.SITE_INPUTS ?? join(repoRoot, ".site-inputs"));
}

export function siteInputsPath(...parts) {
  const root = siteInputsRoot();
  if (!existsSync(join(root, "manifest.json"))) {
    throw new Error(`Core bundle is missing at ${root}. Run npm run bundle:fetch at the repository root, or set SITE_INPUTS.`);
  }
  return join(root, ...parts);
}

export function fileSha(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
