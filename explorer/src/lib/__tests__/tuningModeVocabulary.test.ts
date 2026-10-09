import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NOT_RECORDED_TUNING_MODE } from "@/lib/facetModel";
import { siteInputsPath } from "@/test/siteInputs";

const EXPECTED_MODES = ["tuned", "tuned-fallback", "notuning", "auto", "custom"];
const EXPECTED_NOT_RECORDED_SENTINEL = "not-recorded";

function loadVocabulary(): string[] {
  const contract = JSON.parse(readFileSync(siteInputsPath("explorer", "contract.json"), "utf8")) as { tuning_vocabulary: string[] };
  return contract.tuning_vocabulary;
}

describe("tuning_mode vocabulary pin (ADR-2)", () => {
  it("the core bundle's modes match the ADR-2 decided set", () => {
    expect(loadVocabulary()).toEqual(EXPECTED_MODES);
  });

  it("the Explorer's not-recorded sentinel matches ADR-2 and is not a mode", () => {
    expect(NOT_RECORDED_TUNING_MODE).toBe(EXPECTED_NOT_RECORDED_SENTINEL);
    expect(loadVocabulary()).not.toContain(NOT_RECORDED_TUNING_MODE);
  });

  it("no mode value looks like a raw file path", () => {
    for (const mode of loadVocabulary()) {
      expect(mode.includes("/")).toBe(false);
      expect(mode.includes("\\")).toBe(false);
      expect(mode.endsWith(".yaml")).toBe(false);
    }
  });

  it("'balanced' is not part of the pinned vocabulary", () => {
    expect(loadVocabulary()).not.toContain("balanced");
  });
});
