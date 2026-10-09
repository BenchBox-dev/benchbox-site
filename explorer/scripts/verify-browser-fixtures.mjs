#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { generatedData } from "./generate-browser-fixtures.mjs";
import { fileSha, siteInputsPath } from "./site-inputs.mjs";

export function fixtureErrors(source = siteInputsPath("explorer", "fixtures"), staged = generatedData) {
  const errors = [];
  for (const name of readdirSync(source).sort()) {
    const target = name === "results.duckdb" || name === "fixture-ids.json" ? join(staged, name) : join(staged, "bundles", name);
    if (!existsSync(target)) errors.push(`missing staged fixture ${name}`);
    else if (fileSha(target) !== fileSha(join(source, name))) errors.push(`staged fixture ${name} differs from the core bundle`);
  }
  const idsFile = join(staged, "fixture-ids.json");
  if (!existsSync(idsFile)) return [...errors, "fixture-ids.json is missing"];
  const payload = JSON.parse(readFileSync(idsFile, "utf8"));
  if (JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify(["ids", "shortIds"])) {
    errors.push("fixture-ids.json must hold exactly ids and shortIds");
    return errors;
  }
  for (const [role, id] of Object.entries(payload.ids)) {
    if (!payload.shortIds[role]) errors.push(`fixture role ${role} has no short id`);
    if (!existsSync(join(staged, "bundles", `${id}.json`))) errors.push(`fixture role ${role} names ${id}, which has no bundle`);
  }
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const errors = fixtureErrors();
  for (const error of errors) console.error(`[browser-fixtures] ${error}`);
  if (errors.length > 0) process.exit(1);
  console.log("[browser-fixtures] staged fixtures match the core bundle");
}
