// @vitest-environment node
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXPECTED_READ_MODEL_VERSION, readExplorerBuildContract } from "./explorer-build-contract.mjs";

function writeContract(overrides = {}) {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "build-contract-")), "contract.json");
  writeFileSync(
    file,
    JSON.stringify({
      build_contract: {
        version: "6",
        read_model_version: EXPECTED_READ_MODEL_VERSION,
        read_model_compatibility: { minimum_supported: EXPECTED_READ_MODEL_VERSION, newer_policy: "warn-and-continue" },
        command: "uv run -- python _project/scripts/explorer_publish.py build",
        flags: ["--data-dir", "--output", "--trust-label", "--visibility"],
        outputs: {
          required: ["results.duckdb", "bundles/{result_id}.json"],
          removed_legacy: [
            "manifest.json",
            "benchmarks/",
            "details/",
            "compare/",
            "meta_leaderboard.json",
            "short_ids.json",
            "results_schema.json",
          ],
        },
        ...overrides,
      },
    }),
  );
  return file;
}

describe("readExplorerBuildContract", () => {
  it("accepts a contract equal to the pin", () => {
    expect(readExplorerBuildContract(writeContract()).read_model_version).toBe(EXPECTED_READ_MODEL_VERSION);
  });

  it("rejects a contract one version newer with the alignment hint", () => {
    expect(() => readExplorerBuildContract(writeContract({ read_model_version: EXPECTED_READ_MODEL_VERSION + 1 }))).toThrow(
      /update the Explorer for the new contract before taking this bundle/,
    );
  });

  it("keeps warn-and-continue as the newer-snapshot policy", () => {
    expect(() =>
      readExplorerBuildContract(
        writeContract({
          read_model_compatibility: { minimum_supported: EXPECTED_READ_MODEL_VERSION, newer_policy: "halt" },
        }),
      ),
    ).toThrow(/newer read-model policy warn-and-continue expected/);
  });
});
