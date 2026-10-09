#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { siteInputsDir, verifyBundle } from "./bundle-lib.mjs";

export const CORE_REPO = process.env.CORE_REPO ?? "BenchBox-dev/BenchBox";

export async function githubJson(route, env = process.env) {
  const token = env.GH_TOKEN ?? env.GITHUB_TOKEN;
  const response = await fetch(`https://api.github.com/${route}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${route} returned ${response.status}`);
  return response.json();
}

export function certificationErrors(run, manifest) {
  const errors = [];
  if (!run) return ["certifying trunk run not found"];
  if (!/(^|\/)trunk\.ya?ml$/.test(run.path ?? "")) errors.push(`certified_by run is ${run.path}, not trunk.yml`);
  if (run.event !== "push") errors.push(`certified_by run event is ${run.event}, not push`);
  if (run.head_branch !== "develop") errors.push(`certified_by run branch is ${run.head_branch}, not develop`);
  if (run.conclusion !== "success") errors.push(`certified_by run concluded ${run.conclusion}`);
  if (run.head_sha !== manifest.core_sha) errors.push("certified_by run is for a different commit");
  return errors;
}

export async function verifyWithCertification(dir, { offline = false } = {}) {
  const result = verifyBundle(dir);
  if (!result.manifest || offline) return result;
  if (!/^\d+$/.test(String(result.manifest.certified_by))) {
    result.errors.push(`certified_by ${result.manifest.certified_by} is not a run id`);
  } else {
    try {
      const run = await githubJson(`repos/${CORE_REPO}/actions/runs/${result.manifest.certified_by}`);
      result.errors.push(...certificationErrors(run, result.manifest));
    } catch (error) {
      result.errors.push(`certification check failed closed: ${error.message}`);
    }
  }
  result.ok = result.errors.length === 0;
  return result;
}

async function main(argv) {
  const offline = argv.includes("--offline");
  const dir = argv.find((arg) => !arg.startsWith("--")) ?? siteInputsDir();
  const result = await verifyWithCertification(dir, { offline });
  for (const error of result.errors) console.error(`bundle: ${error}`);
  if (!result.ok) return 1;
  const { core_sha: core, schema, package_version: version } = result.manifest;
  console.log(`bundle OK: schema ${schema}, core ${core}, package ${version}${offline ? " (certification not checked)" : ""}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
