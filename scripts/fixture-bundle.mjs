#!/usr/bin/env node
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CANDIDATE_CERTIFIER, DOCS_DATA_FILE, SCHEMA_DIR, memberDigest, membersFor } from "./bundle-lib.mjs";
import { minimalInstance } from "./schema-instance.mjs";

export const FIXTURE_CORE = "a".repeat(40);
export const FIXTURE_PARENT = "b".repeat(40);

function write(file, body) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
}

function schemaInstance(name) {
  return `${JSON.stringify(minimalInstance(path.join(SCHEMA_DIR, `${name}.schema.json`)))}\n`;
}

export function fixtureBundle({ schema = 4, attestationResult = "pass", tamper = false, dir, certifiedBy, contractOverrides = {} } = {}) {
  const root = dir ?? mkdtempSync(path.join(tmpdir(), "bundle-fixture-"));
  const required = membersFor(schema) ?? membersFor(4);
  for (const member of required) {
    if (member === "attestations.json") continue;
    if (member === "docs-data") write(path.join(root, member, DOCS_DATA_FILE), contractOverrides["docs-data"] ?? schemaInstance("docs-data"));
    else if (member === "doc-contracts.json") write(path.join(root, member), contractOverrides[member] ?? schemaInstance("doc-contracts"));
    else if (member.endsWith(".json") || member.endsWith(".duckdb")) write(path.join(root, member), `${member}\n`);
    else write(path.join(root, member, "item.txt"), `${member}\n`);
  }
  const snapshot = memberDigest(path.join(root, "explorer/results.duckdb"));
  const attestations = [
    { name: "privacy", result: attestationResult, inputs: { bundle: "fixture" }, compared: { core_sha: FIXTURE_CORE } },
    { name: "explorer_compat", result: "pass", inputs: { snapshot }, compared: { core_sha: FIXTURE_CORE } },
    { name: "snapshot_invariants", result: "pass", inputs: { snapshot }, compared: { core_sha: FIXTURE_CORE } },
    { name: "corpus_bijection", result: "pass", inputs: { snapshot }, compared: { accepted_ref: FIXTURE_CORE } },
    { name: "validator_parity", result: "skip", reason: "corpus unchanged", compared: { base: FIXTURE_PARENT, head: FIXTURE_CORE } },
  ];
  write(path.join(root, "attestations.json"), `${JSON.stringify(attestations)}\n`);
  const members = Object.fromEntries(required.map((member) => [member, memberDigest(path.join(root, member))]));
  write(
    path.join(root, "manifest.json"),
    JSON.stringify({
      schema,
      core_sha: FIXTURE_CORE,
      parent_core_sha: FIXTURE_PARENT,
      parent_source: "bundle",
      corpus_sha: "c".repeat(40),
      package_version: "0.0.0",
      certified_by: certifiedBy ?? CANDIDATE_CERTIFIER,
      members,
    }),
  );
  if (tamper) write(path.join(root, "docs/item.txt"), "changed\n");
  return root;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [schema, dir] = process.argv.slice(2);
  console.log(fixtureBundle({ schema: Number(schema), dir }));
}
