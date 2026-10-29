// @vitest-environment node
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LATEST_READ_MODEL_VERSION, MINIMUM_READ_MODEL_VERSION, readExplorerBuildContract } from "./explorer-build-contract.mjs";

function writeContract(overrides = {}) {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "build-contract-")), "contract.json");
  writeFileSync(
    file,
    JSON.stringify({
      build_contract: {
        version: "6",
        read_model_version: MINIMUM_READ_MODEL_VERSION,
        read_model_compatibility: { minimum_supported: MINIMUM_READ_MODEL_VERSION, newer_policy: "warn-and-continue" },
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
  it("accepts a contract equal to the minimum pin", () => {
    expect(readExplorerBuildContract(writeContract()).read_model_version).toBe(MINIMUM_READ_MODEL_VERSION);
  });

  it("accepts the latest read model with its own minimum", () => {
    const contract = readExplorerBuildContract(
      writeContract({
        read_model_version: LATEST_READ_MODEL_VERSION,
        read_model_compatibility: { minimum_supported: LATEST_READ_MODEL_VERSION, newer_policy: "warn-and-continue" },
      }),
    );
    expect(contract.read_model_version).toBe(LATEST_READ_MODEL_VERSION);
  });

  it("accepts the latest read model while the minimum stays at the oldest supported", () => {
    expect(readExplorerBuildContract(writeContract({ read_model_version: LATEST_READ_MODEL_VERSION })).read_model_version).toBe(
      LATEST_READ_MODEL_VERSION,
    );
  });

  it("rejects a contract one version newer than the latest with the alignment hint", () => {
    expect(() => readExplorerBuildContract(writeContract({ read_model_version: LATEST_READ_MODEL_VERSION + 1 }))).toThrow(
      /update the Explorer for the new contract before taking this bundle/,
    );
  });

  it("rejects a contract older than the minimum with the alignment hint", () => {
    expect(() => readExplorerBuildContract(writeContract({ read_model_version: MINIMUM_READ_MODEL_VERSION - 1 }))).toThrow(
      /update the Explorer for the new contract before taking this bundle/,
    );
  });

  it("rejects a minimum_supported outside the supported range", () => {
    expect(() =>
      readExplorerBuildContract(
        writeContract({ read_model_compatibility: { minimum_supported: LATEST_READ_MODEL_VERSION + 1, newer_policy: "warn-and-continue" } }),
      ),
    ).toThrow(/minimum supported read-model version/);
  });

  it("keeps warn-and-continue as the newer-snapshot policy", () => {
    expect(() =>
      readExplorerBuildContract(
        writeContract({
          read_model_compatibility: { minimum_supported: MINIMUM_READ_MODEL_VERSION, newer_policy: "halt" },
        }),
      ),
    ).toThrow(/newer read-model policy warn-and-continue expected/);
  });
});
