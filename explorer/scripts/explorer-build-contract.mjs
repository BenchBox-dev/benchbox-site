import { readFileSync } from "node:fs";
import { siteInputsPath } from "./site-inputs.mjs";

const EXPECTED_CONTRACT_VERSION = "6";
export const EXPECTED_READ_MODEL_VERSION = 14;
const EXPECTED_NEWER_READ_MODEL_POLICY = "warn-and-continue";
const REQUIRED_FLAGS = ["--data-dir", "--output", "--trust-label", "--visibility"];
const REQUIRED_OUTPUTS = ["results.duckdb", "bundles/{result_id}.json"];
const REMOVED_LEGACY_OUTPUTS = [
  "manifest.json",
  "benchmarks/",
  "details/",
  "compare/",
  "meta_leaderboard.json",
  "short_ids.json",
  "results_schema.json",
];
export const EXPECTED_COMMAND = "uv run -- python _project/scripts/explorer_publish.py build";
const ALIGNMENT_HINT =
  "The core bundle's explorer/contract.json no longer matches explorer/scripts/explorer-build-contract.mjs; " +
  "update the Explorer for the new contract before taking this bundle.";

export function readExplorerBuildContract(file = siteInputsPath("explorer", "contract.json")) {
  let contract;
  try {
    contract = JSON.parse(readFileSync(file, "utf8")).build_contract;
  } catch (error) {
    throw new Error(`Explorer build contract was not readable from ${file}. ${ALIGNMENT_HINT}\n${String(error)}`);
  }
  if (!contract) throw new Error(`Explorer build contract is missing from ${file}. ${ALIGNMENT_HINT}`);

  if (contract.version !== EXPECTED_CONTRACT_VERSION) {
    throw new Error(`Explorer build contract version ${EXPECTED_CONTRACT_VERSION} expected, got ${contract.version}. ${ALIGNMENT_HINT}`);
  }
  if (contract.command !== EXPECTED_COMMAND) {
    throw new Error(`Explorer build contract command ${EXPECTED_COMMAND} expected, got ${contract.command}. ${ALIGNMENT_HINT}`);
  }
  if (contract.read_model_version !== EXPECTED_READ_MODEL_VERSION) {
    throw new Error(`Explorer read-model version ${EXPECTED_READ_MODEL_VERSION} expected, got ${contract.read_model_version}. ${ALIGNMENT_HINT}`);
  }
  const compatibility = contract.read_model_compatibility ?? {};
  if (compatibility.minimum_supported !== EXPECTED_READ_MODEL_VERSION) {
    throw new Error(
      `Explorer minimum supported read-model version ${EXPECTED_READ_MODEL_VERSION} expected, got ${compatibility.minimum_supported}. ${ALIGNMENT_HINT}`,
    );
  }
  if (compatibility.newer_policy !== EXPECTED_NEWER_READ_MODEL_POLICY) {
    throw new Error(
      `Explorer newer read-model policy ${EXPECTED_NEWER_READ_MODEL_POLICY} expected, got ${compatibility.newer_policy}. ${ALIGNMENT_HINT}`,
    );
  }
  const actualFlags = new Set(contract.flags ?? []);
  for (const flag of REQUIRED_FLAGS) {
    if (!actualFlags.has(flag)) throw new Error(`Explorer build contract missing required flag ${flag}. ${ALIGNMENT_HINT}`);
  }
  const outputs = contract.outputs ?? {};
  assertIncludesAll(outputs.required, REQUIRED_OUTPUTS, "required");
  assertIncludesAll(outputs.removed_legacy, REMOVED_LEGACY_OUTPUTS, "removed_legacy");
  return contract;
}

function assertIncludesAll(actual, expected, fieldName) {
  if (!Array.isArray(actual)) throw new Error(`Explorer build contract outputs.${fieldName} must be an array. ${ALIGNMENT_HINT}`);
  const actualSet = new Set(actual);
  for (const value of expected) {
    if (!actualSet.has(value)) throw new Error(`Explorer build contract outputs.${fieldName} missing ${value}. ${ALIGNMENT_HINT}`);
  }
}
