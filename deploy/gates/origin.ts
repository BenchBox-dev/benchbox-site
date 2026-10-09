import { readFileSync } from "node:fs";
import path from "node:path";
import { filesUnder } from "./files.ts";
import { fail, pass, skipped, type GateResult } from "./types.ts";

export const PRODUCTION_ORIGIN = "https://benchbox.dev";
const TEXT = /\.(html?|xml|txt|json|js|css|svg|webmanifest)$/i;

export function originGate(input: { siteDir: string; target: string; allowlist: RegExp[] }): GateResult {
  if (input.target !== "rehearsal") return skipped(`origin is only checked for rehearsal artifacts, not ${input.target || "an unset target"}`);
  const offenders = filesUnder(input.siteDir)
    .filter((file) => TEXT.test(file))
    .filter((file) => !input.allowlist.some((pattern) => pattern.test(file)))
    .filter((file) => readFileSync(path.join(input.siteDir, file), "utf8").includes(PRODUCTION_ORIGIN));
  return offenders.length === 0
    ? pass(`no ${PRODUCTION_ORIGIN} outside the allowlist`)
    : fail(`${offenders.length} files carry ${PRODUCTION_ORIGIN} outside the allowlist`, offenders);
}
