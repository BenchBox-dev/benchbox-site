#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildSnapshot, exampleRowIds, pickRankedSingles, readContract } from "./read-model-snapshot.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
export const CONTRACT_FILE = path.join(repoRoot, "explorer", "test-fixtures", "next-read-model", "next_read_model_contract.json");
export const ASSIGNMENTS_FILE = "read-model-assignments.json";

const EMBED_PAGE = path.join(repoRoot, "docs", "design", "results-embeds.md");
const COHORT = { benchmark: "tpch", scaleFactor: 0.01, testType: "power" };

export function embedPageResultIds(page = EMBED_PAGE) {
  const ids = [...readFileSync(page, "utf8").matchAll(/^\s*(?:result: "|- )(tpch-[A-Za-z0-9._-]+)/gm)].map((match) => match[1]);
  return [...new Set(ids)].filter((id) => !id.endsWith("-00000000"));
}

function pickRemaining(conn, taken, benchmark) {
  const row = conn
    .query(
      `SELECT min(result_id) AS result_id FROM results WHERE benchmark = '${benchmark}'` +
        ` AND ranking_exclusion_reason IS NULL AND visibility = 'public-curated'` +
        ` AND result_id NOT IN (${taken.map((id) => `'${id}'`).join(", ")})`,
    )
    .toArray()[0]
    .toJSON();
  if (!row.result_id) throw new Error("the snapshot has no further ranked result to carry the third example");
  return row.result_id;
}

export async function stageReadModelInputs({ source, out, contractFile = CONTRACT_FILE }) {
  const contract = readContract(contractFile);
  const [rankedRelease, preRelease, partial] = exampleRowIds(contract);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(path.join(out, "explorer"), { recursive: true });
  for (const name of readdirSync(source)) {
    if (name !== "explorer") symlinkSync(path.join(source, name), path.join(out, name));
  }
  for (const name of readdirSync(path.join(source, "explorer"))) {
    if (name === "results.duckdb" || name === "contract.json" || name === "fixtures") continue;
    symlinkSync(path.join(source, "explorer", name), path.join(out, "explorer", name));
  }
  const bundleContract = JSON.parse(readFileSync(path.join(source, "explorer", "contract.json"), "utf8"));
  bundleContract.read_model_version = contract.read_model_version;
  bundleContract.build_contract.read_model_version = contract.read_model_version;
  writeFileSync(path.join(out, "explorer", "contract.json"), `${JSON.stringify(bundleContract, null, 2)}\n`);

  const embedIds = embedPageResultIds();
  const full = await buildSnapshot({
    sourceFile: path.join(source, "explorer", "results.duckdb"),
    outputFile: path.join(out, "explorer", "results.duckdb"),
    contractFile,
    assignments: (conn) => {
      const [first, second] = embedIds;
      const third = pickRemaining(conn, [first, second], "tpch");
      return { [first]: preRelease, [second]: rankedRelease, [third]: partial };
    },
  });

  mkdirSync(path.join(out, "explorer", "fixtures"), { recursive: true });
  for (const name of readdirSync(path.join(source, "explorer", "fixtures"))) {
    if (name !== "results.duckdb") symlinkSync(path.join(source, "explorer", "fixtures", name), path.join(out, "explorer", "fixtures", name));
  }
  let unlabelled = "";
  const fixtures = await buildSnapshot({
    sourceFile: path.join(source, "explorer", "fixtures", "results.duckdb"),
    outputFile: path.join(out, "explorer", "fixtures", "results.duckdb"),
    contractFile,
    assignments: (conn) => {
      const [first, second, third] = pickRankedSingles(conn, { ...COHORT, count: 3 });
      unlabelled = pickRemaining(conn, [first, second, third], COHORT.benchmark);
      return { [first]: rankedRelease, [second]: preRelease, [third]: partial };
    },
  });

  const assignments = {
    readModelVersion: contract.read_model_version,
    snapshot: full.assigned,
    fixtures: fixtures.assigned,
    fixturePlatforms: fixtures.platforms,
    fixtureUnlabelled: unlabelled,
  };
  writeFileSync(path.join(out, ASSIGNMENTS_FILE), `${JSON.stringify(assignments, null, 2)}\n`);
  return assignments;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { values } = parseArgs({
    options: {
      source: { type: "string", default: path.join(repoRoot, ".site-inputs") },
      out: { type: "string" },
    },
  });
  if (!values.out) {
    console.error("usage: node scripts/stage-read-model-inputs.mjs --out <directory> [--source <site inputs>]");
    process.exit(2);
  }
  const source = path.resolve(values.source);
  const out = path.resolve(values.out);
  if (!existsSync(path.join(source, "manifest.json"))) {
    console.error(`${source} is not a core bundle directory`);
    process.exit(2);
  }
  if (source === out || source.startsWith(`${out}${path.sep}`) || out.startsWith(`${source}${path.sep}`)) {
    console.error("--out must be a directory apart from --source");
    process.exit(2);
  }
  const assignments = await stageReadModelInputs({ source, out });
  console.log(`staged read-model ${assignments.readModelVersion} inputs into ${out}`);
}
