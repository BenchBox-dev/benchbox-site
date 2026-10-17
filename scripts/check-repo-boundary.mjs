#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PRODUCTION_ORIGIN = "https://benchbox.dev";
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".astro", ".html", ".css"]);
const PYTHON_FILES = /(^|\/)(pyproject\.toml|uv\.lock)$|\.py$/;
const PYTHON_CALL = /\b(spawnSync|spawn|execFileSync|execFile|execSync|exec)\(\s*["'`](python3?|uvx?)["'`]/;
const PYTHON_SCRIPT = /(^|[\s;&|(])(python3?|uvx?)(\s|$)/;
const OLD_LAYOUT = /results-explorer\/|["'`/]_project\/|docs\/_templates|pyproject\.toml|results-data\/|tests\/parity\/fixtures|site-inventory\//;
const RELATIVE_LITERAL = /["'`]((?:\.\.\/)+[^"'`\s]*)["'`]/g;

export const ORIGIN_ALLOWLIST = [
  /^blog\//,
  /^drafts\//,
  /^inventory\//,
  /^landing\/(index|prompts\/index)\.html$/,
  /(^|\/)tests?\//,
  /\.test\.(ts|tsx|mjs)$/,
  /\.spec\.ts$/,
  /^explorer\/e2e\/captures\/.+-output\//,
  /^explorer\/vite\.config\.ts$/,
  /^explorer\/index\.html$/,
  /^explorer\/src\/components\/siteOrigin\.ts$/,
  /^website\/src\/lib\/site-origin\.ts$/,
  /^deploy\/gates\/(links|origin)\.ts$/,
  /^scripts\/check-repo-boundary(\.test)?\.mjs$/,
  /^AGENTS\.md$/,
];
const BOUNDARY_ALLOWLIST = [
  /^scripts\/check-repo-boundary(\.test)?\.mjs$/,
  /^drafts\//,
  /^inventory\//,
  /^explorer\/e2e\/captures\//,
  /^explorer\/src\/__tests__\/userFacingStringHygiene\.test\.ts$/,
];
const RELATIVE_EXEMPT = /(^|\/)tests?\//;

export function findingsFor(file, source) {
  const findings = [];
  const extension = path.extname(file);
  if (PYTHON_FILES.test(file)) findings.push(`${file}: Python file in the repository`);
  if (path.basename(file) === "package.json") {
    for (const [name, command] of Object.entries(JSON.parse(source).scripts ?? {})) {
      if (PYTHON_SCRIPT.test(command)) findings.push(`${file}: npm script ${name} runs Python or uv`);
    }
  }
  const boundaryChecked = SOURCE_EXTENSIONS.has(extension) && !BOUNDARY_ALLOWLIST.some((pattern) => pattern.test(file));
  if (boundaryChecked) {
    const lines = source.split("\n");
    lines.forEach((line, index) => {
      if (PYTHON_CALL.test(line)) findings.push(`${file}:${index + 1}: runs Python or uv`);
      if (OLD_LAYOUT.test(line)) findings.push(`${file}:${index + 1}: names a path from the old core layout`);
      for (const match of RELATIVE_EXEMPT.test(file) ? [] : line.matchAll(RELATIVE_LITERAL)) {
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
        if (resolved.startsWith("..")) findings.push(`${file}:${index + 1}: ${match[1]} resolves outside the repository`);
      }
    });
  }
  if (source.includes(PRODUCTION_ORIGIN) && !ORIGIN_ALLOWLIST.some((pattern) => pattern.test(file))) {
    findings.push(`${file}: hard-codes ${PRODUCTION_ORIGIN}; use SITE_ORIGIN`);
  }
  return findings;
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
}

function main() {
  const findings = [];
  for (const file of trackedFiles()) {
    if (/\.(png|jpe?g|gif|webp|ico|svg|woff2?|duckdb|wasm|zst|gz|pdf)$/i.test(file)) {
      if (PYTHON_FILES.test(file)) findings.push(`${file}: Python file in the repository`);
      continue;
    }
    findings.push(...findingsFor(file, readFileSync(file, "utf8")));
  }
  for (const finding of findings) console.log(finding);
  console.log(`repository boundary: ${findings.length} findings`);
  return findings.length === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
