import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startSiteServer } from "./site-server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const siteDir = path.resolve(process.env.SITE_DIR ?? path.join(repoRoot, "website", "dist"));
const inputs = path.resolve(process.env.SITE_INPUTS ?? path.join(repoRoot, ".site-inputs"));
const assignmentsFile = path.join(inputs, "read-model-assignments.json");
if (!existsSync(assignmentsFile)) {
  console.error(`${assignmentsFile} is missing; stage the read-model inputs with scripts/stage-read-model-inputs.mjs and build the site from them`);
  process.exit(2);
}
const assignments = JSON.parse(readFileSync(assignmentsFile, "utf8"));

const DERIVED = "Derived from TPC-H. These results do not comply with the TPC-H Specification and must not be compared with official TPC-H results.";
const CLASS_POWER_ONLY = "Power test only";
const ROW_COUNTS = "Row counts not checked";
const ITERATION = "Single iteration";
const DERIVED_DS = "Derived from TPC-DS. These results do not comply with the TPC-DS Specification and must not be compared with official TPC-DS results.";
const CLASS_PARTIAL = "Partial run: not every required phase ran";

const EXPECTED = {
  "example-ranked-release": [DERIVED, CLASS_POWER_ONLY],
  "example-pre-release": [DERIVED, CLASS_POWER_ONLY, ROW_COUNTS, ITERATION],
  "example-version-not-recorded": [DERIVED_DS, CLASS_PARTIAL, ROW_COUNTS],
};

function resultFor(example) {
  const id = Object.entries(assignments.snapshot).find(([, exampleId]) => exampleId === example)?.[0];
  if (!id) throw new Error(`no result in the staged snapshot carries ${example}`);
  return id;
}

const failures = [];
const fail = (message) => failures.push(message);

function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function html(base, route) {
  const response = await fetch(base + route);
  if (!response.ok) throw new Error(`${route} answered ${response.status}`);
  return response.text();
}

const { server, served } = await startSiteServer(siteDir, path.join(inputs, "explorer"));
const base = `http://127.0.0.1:${server.address().port}`;

for (const [example, expected] of Object.entries(EXPECTED)) {
  const id = resultFor(example);
  const page = await html(base, `/results/r/${id}`);
  const list = /<ul class="bb-static-corpus-labels"[^>]*>(.*?)<\/ul>/s.exec(page);
  if (!list) {
    fail(`the static receipt of ${id} has no corpus label list`);
    continue;
  }
  const items = [...list[1].matchAll(/<li>(.*?)<\/li>/gs)].map((match) => match[1]);
  if (JSON.stringify(items) !== JSON.stringify(expected.map(escapeHtml))) fail(`the static receipt of ${id} lists ${JSON.stringify(items)}, expected ${JSON.stringify(expected)}`);
}

const summary = await html(base, "/result-summaries/benchmarks/tpch.html");
const summaryLists = [...summary.matchAll(/<ul class="result-summary__labels"[^>]*data-testid="summary-corpus-labels"[^>]*>(.*?)<\/ul>/gs)].map((match) =>
  [...match[1].matchAll(/<li[^>]*>(.*?)<\/li>/gs)].map((item) => item[1]),
);
for (const [example, expected] of Object.entries(EXPECTED)) {
  const found = summaryLists.some((items) => JSON.stringify(items) === JSON.stringify(expected.map(escapeHtml)));
  if (!found) fail(`the TPC-H result summary has no label list equal to ${JSON.stringify(expected)} (${example})`);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await page.goto(`${base}/docs/design/results-embeds.html`, { waitUntil: "networkidle" });
  await page.locator('[data-embed="cited"]').first().scrollIntoViewIfNeeded();
  await page.locator('[data-embed="current"]').first().scrollIntoViewIfNeeded();
  await page.locator('[data-embed="current"] tr[data-state="published"]').first().waitFor({ state: "visible", timeout: 60000 });
  await page.locator('[data-embed="cited"] [data-testid="embed-corpus-labels"]').first().waitFor({ state: "visible", timeout: 60000 }).catch(() => null);

  const cited = page.locator('[data-embed="cited"]').first();
  const citedLabels = await cited.locator("[data-testid=embed-corpus-label]").allTextContents();
  const expectedCited = EXPECTED["example-pre-release"];
  if (JSON.stringify(citedLabels) !== JSON.stringify(expectedCited)) fail(`the cited embed lists ${JSON.stringify(citedLabels)}, expected ${JSON.stringify(expectedCited)}`);

  const current = page.locator('[data-embed="current"]').first();
  for (const [example, expected] of [
    ["example-pre-release", EXPECTED["example-pre-release"]],
    ["example-ranked-release", EXPECTED["example-ranked-release"]],
  ]) {
    const id = resultFor(example);
    const row = current.locator("tbody tr", { has: page.locator(`a[href$="${id}"]`) });
    const labels = await row.locator("[data-testid=embed-corpus-label]").allTextContents();
    if (JSON.stringify(labels) !== JSON.stringify(expected)) fail(`the current embed row of ${id} lists ${JSON.stringify(labels)}, expected ${JSON.stringify(expected)}`);
  }
  const loaded = served.filter((item) => item.path.endsWith("results.duckdb"));
  if (loaded.length === 0) fail("the snapshot was never read after the embed became visible");
  if (pageErrors.length > 0) fail(`the page threw: ${pageErrors.join(" | ")}`);
  await context.close();
} finally {
  await browser.close();
  server.close();
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("corpus label checks passed: static receipts, result summaries, cited and current embeds");
}
