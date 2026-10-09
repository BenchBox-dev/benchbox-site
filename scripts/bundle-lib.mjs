import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

export const SUPPORTED_SCHEMAS = [2, 3];
const SCHEMA_1_MEMBERS = [
  "docs",
  "repo-files.json",
  "explorer/results.duckdb",
  "explorer/contract.json",
  "explorer/fixtures",
  "explorer/parity",
  "landing/prompt-catalog.json",
  "api-public-symbols.json",
  "attestations.json",
];
const MEMBERS_BY_SCHEMA = {
  1: SCHEMA_1_MEMBERS,
  2: [...SCHEMA_1_MEMBERS, "downloads"],
  3: [...SCHEMA_1_MEMBERS, "downloads", "explorer/bundles"],
};
export const REQUIRED_MEMBERS = MEMBERS_BY_SCHEMA[3];

export function membersFor(schema) {
  return MEMBERS_BY_SCHEMA[schema] ?? REQUIRED_MEMBERS;
}
export const REQUIRED_ATTESTATIONS = ["privacy", "explorer_compat", "snapshot_invariants", "corpus_bijection"];
export const OPTIONAL_ATTESTATIONS = ["validator_parity"];
export const PARENT_SOURCES = ["bundle", "dispatch", "local"];

export function siteInputsDir(env = process.env) {
  return path.resolve(env.SITE_INPUTS ?? ".site-inputs");
}

export function fileSha(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function comparePathParts(left, right) {
  const a = left.split("/");
  const b = right.split("/");
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return a.length - b.length;
}

function walkFiles(root, prefix = "") {
  const files = [];
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walkFiles(root, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

export function memberDigest(target) {
  if (!existsSync(target)) throw new Error(`bundle member missing: ${target}`);
  if (statSync(target).isFile()) return fileSha(target);
  const lines = walkFiles(target)
    .sort(comparePathParts)
    .map((relative) => `${relative}:${fileSha(path.join(target, relative))}`);
  return createHash("sha256").update(`${lines.join("\n")}\n`).digest("hex");
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function checkManifest(dir, { supportedSchemas = SUPPORTED_SCHEMAS } = {}) {
  const errors = [];
  const manifestPath = path.join(dir, "manifest.json");
  if (!existsSync(manifestPath)) return { errors: ["manifest.json missing"], manifest: null };
  const manifest = readJson(manifestPath);
  if (!supportedSchemas.includes(manifest.schema)) {
    errors.push(`schema ${JSON.stringify(manifest.schema)} is not supported (supported: ${supportedSchemas.join(", ")})`);
  }
  for (const field of ["core_sha", "parent_core_sha", "corpus_sha", "package_version", "certified_by"]) {
    if (!manifest[field]) errors.push(`manifest field ${field} is missing`);
  }
  if (manifest.core_sha && !/^[0-9a-f]{40}$/.test(manifest.core_sha)) errors.push("core_sha is not a full commit SHA");
  if (manifest.parent_core_sha && !/^[0-9a-f]{40}$/.test(manifest.parent_core_sha)) {
    errors.push("parent_core_sha is not a full commit SHA");
  }
  if (manifest.parent_source !== undefined && !PARENT_SOURCES.includes(manifest.parent_source)) {
    errors.push(`unknown parent_source ${JSON.stringify(manifest.parent_source)}`);
  }
  const members = manifest.members ?? {};
  const names = Object.keys(members).sort();
  if (JSON.stringify(names) !== JSON.stringify([...membersFor(manifest.schema)].sort())) {
    errors.push(`member set mismatch: ${names.join(", ")}`);
  }
  for (const name of names) {
    if (!members[name]) {
      errors.push(`empty digest for ${name}`);
      continue;
    }
    try {
      if (memberDigest(path.join(dir, name)) !== members[name]) errors.push(`digest mismatch: ${name}`);
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { errors, manifest };
}

export function checkAttestations(dir, manifest) {
  const errors = [];
  const file = path.join(dir, "attestations.json");
  if (!existsSync(file)) return ["attestations.json missing"];
  const entries = readJson(file);
  if (!Array.isArray(entries) || entries.length === 0) return ["attestations are empty"];
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  for (const name of [...REQUIRED_ATTESTATIONS, ...OPTIONAL_ATTESTATIONS]) {
    if (!byName.has(name)) errors.push(`attestation ${name} is missing`);
  }
  for (const entry of entries) {
    if (entry.result === "fail") errors.push(`attestation ${entry.name} failed`);
    else if (entry.result === "skip") {
      if (REQUIRED_ATTESTATIONS.includes(entry.name)) errors.push(`required attestation ${entry.name} was skipped`);
      if (!entry.reason) errors.push(`attestation ${entry.name} was skipped without a reason`);
    } else if (entry.result !== "pass") errors.push(`attestation ${entry.name} has unknown result ${entry.result}`);
    if (entry.result === "pass" && !entry.inputs) errors.push(`attestation ${entry.name} passed without inputs`);
    const compared = entry.compared ?? {};
    if (manifest) {
      if ("head" in compared && compared.head !== manifest.core_sha) errors.push(`${entry.name} head differs from core_sha`);
      if ("core_sha" in compared && compared.core_sha !== manifest.core_sha) errors.push(`${entry.name} core_sha differs`);
      if ("accepted_ref" in compared && compared.accepted_ref !== manifest.core_sha) {
        errors.push(`${entry.name} accepted_ref differs from core_sha`);
      }
      if ("base" in compared && compared.base !== manifest.parent_core_sha) {
        errors.push(`${entry.name} base differs from parent_core_sha`);
      }
      const snapshot = manifest.members?.["explorer/results.duckdb"];
      if (entry.inputs?.snapshot && snapshot && entry.inputs.snapshot !== snapshot) {
        errors.push(`${entry.name} snapshot input differs from the manifest`);
      }
    }
  }
  return errors;
}

export function verifyBundle(dir, options = {}) {
  const { errors, manifest } = checkManifest(dir, options);
  if (manifest) errors.push(...checkAttestations(dir, manifest));
  return { ok: errors.length === 0, errors, manifest };
}
