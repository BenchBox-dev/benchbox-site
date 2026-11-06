import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";
import { startSiteServer } from "./site-server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const siteDir = path.resolve(process.env.SITE_DIR ?? path.join(repoRoot, "website", "dist"));
const dataDir = path.join(process.env.SITE_INPUTS ?? path.join(repoRoot, ".site-inputs"), "explorer");
const outDir = process.env.OUT_DIR ?? path.join(os.tmpdir(), "benchbox-website-e2e");
mkdirSync(outDir, { recursive: true });

const route = "/docs/design/results-embeds.html";
const explorerAsset = /^\/results\/|duckdb|\.wasm$|\.worker/i;
const failures = [];
const report = {};

function fail(message) {
  failures.push(message);
}

const { server, served } = await startSiteServer(siteDir, dataDir);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

async function open(theme) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  if (theme) await context.addInitScript((value) => localStorage.setItem("benchbox:theme", value), theme);
  const page = await context.newPage();
  const requests = [];
  const pageErrors = [];
  page.on("request", (request) => requests.push({ url: new URL(request.url()).pathname, type: request.resourceType() }));
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await page.goto(base + route, { waitUntil: "networkidle" });
  return { page, context, requests, pageErrors };
}

async function blocking(page) {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(", ")}`);
}

for (const theme of ["light", "dark"]) {
  const { page, context, requests, pageErrors } = await open(theme);
  const entry = (report[theme] = {});
  const embeds = page.locator("[data-embed]");
  entry.embeds = await embeds.count();
  if (entry.embeds < 2) fail(`${theme}: ${route} renders ${entry.embeds} embeds, expected a cited and a current one`);

  const firstTop = await embeds.first().evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
  if (firstTop <= 900) fail(`${theme}: the first embed is inside the first viewport (${Math.round(firstTop)}px), so lazy loading cannot be checked`);

  const early = requests.filter((entryRequest) => entryRequest.type !== "document" && explorerAsset.test(entryRequest.url));
  const earlyWorkers = page.workers().length;
  entry.beforeScroll = { explorerRequests: early.map((request) => request.url), workers: earlyWorkers };
  if (early.length || earlyWorkers) fail(`${theme}: an embed below the fold loaded Explorer code before it was visible: ${JSON.stringify(entry.beforeScroll)}`);

  const staticCited = (await page.locator('[data-embed="cited"]').first().textContent()) ?? "";
  if (!/Cited result/.test(staticCited) || !/sha256:[0-9a-f]{12}/.test(staticCited)) fail(`${theme}: the cited embed does not show its snapshot identity: ${staticCited}`);

  await embeds.first().scrollIntoViewIfNeeded();
  await page.locator('[data-embed="current"]').first().scrollIntoViewIfNeeded();
  await page.locator('[data-embed="current"] tr[data-state="published"]').first().waitFor({ state: "visible", timeout: 60000 }).catch(() => null);
  await page.waitForLoadState("networkidle").catch(() => null);

  const rows = await page.locator('[data-embed="current"] tbody tr').evaluateAll((trs) => trs.map((tr) => ({ state: tr.getAttribute("data-state"), text: tr.textContent.trim().replace(/\s+/g, " ") })));
  entry.rows = rows;
  if (!rows.some((row) => row.state === "published")) fail(`${theme}: no current result row was published: ${JSON.stringify(rows)}`);
  if (!rows.some((row) => row.state === "withdrawn")) fail(`${theme}: the result that is not in the snapshot did not render as withdrawn: ${JSON.stringify(rows)}`);
  if (rows.some((row) => row.state === "loading")) fail(`${theme}: a current result row is still loading: ${JSON.stringify(rows)}`);

  const cited = await page.locator('[data-embed="cited"]').first().evaluate((element) => ({ state: element.getAttribute("data-state"), text: element.textContent.replace(/\s+/g, " ").trim(), status: element.querySelector("[role=status]")?.getAttribute("data-status") ?? null }));
  entry.cited = cited;
  if (!cited.status) fail(`${theme}: the cited embed never reported on the current snapshot: ${JSON.stringify(cited)}`);

  const loaded = served.filter((item) => /duckdb|\.wasm|\.worker/i.test(item.path));
  entry.afterScroll = { workers: page.workers().length, assets: loaded.map((item) => item.path) };
  if (!loaded.some((item) => item.path.endsWith("results.duckdb"))) fail(`${theme}: the snapshot was never read after the embed became visible`);

  const violations = await blocking(page);
  entry.axe = violations;
  if (violations.length) fail(`${theme}: axe found serious or critical violations: ${violations.join("; ")}`);
  if (pageErrors.length) fail(`${theme}: the page threw: ${pageErrors.join(" | ")}`);
  await page.screenshot({ path: path.join(outDir, `results-embed-${theme}.png`), fullPage: true });
  await context.close();
}

await browser.close();
server.close();
report.failures = failures;
writeFileSync(path.join(outDir, "results-embed.json"), JSON.stringify(report, null, 2));
console.log(`wrote ${path.join(outDir, "results-embed.json")}`);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("results embed checks passed");
}
