#!/usr/bin/env node
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { explorerRoot, siteInputsPath } from "./site-inputs.mjs";

export const generatedRoot = resolve(process.env.E2E_FIXTURE_OUTPUT_ROOT ?? join(explorerRoot, "test-fixtures", ".generated"));
export const generatedData = join(generatedRoot, "data");

export function stageBrowserFixtures(source = siteInputsPath("explorer", "fixtures"), target = generatedData) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(join(target, "bundles"), { recursive: true });
  let bundles = 0;
  for (const name of readdirSync(source).sort()) {
    if (name === "results.duckdb" || name === "fixture-ids.json") {
      copyFileSync(join(source, name), join(target, name));
    } else if (name.endsWith(".json")) {
      copyFileSync(join(source, name), join(target, "bundles", name));
      bundles += 1;
    }
  }
  return bundles;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const member = process.env.E2E_FIXTURE_PROFILE === "large" ? "fixtures-large" : "fixtures";
  const bundles = stageBrowserFixtures(siteInputsPath("explorer", member));
  console.log(`[browser-fixtures] staged the core bundle fixtures (${bundles} result bundles) into ${generatedData}`);
}
