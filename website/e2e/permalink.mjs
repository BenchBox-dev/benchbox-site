import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startSiteServer } from "./site-server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const siteDir = path.resolve(process.env.SITE_DIR ?? path.join(repoRoot, "website", "dist"));
const dataDir = path.resolve(process.env.EXPLORER_DATA_DIR ?? path.join(process.env.SITE_INPUTS ?? path.join(repoRoot, ".site-inputs"), "explorer"));
const shotDir = process.env.PERMALINK_SCREENSHOT_DIR;

for (const required of [path.join(siteDir, "404.html"), path.join(siteDir, "results", "r"), path.join(dataDir, "results.duckdb")]) {
  if (!existsSync(required)) throw new Error(`missing e2e input: ${required}`);
}

const ids = readdirSync(path.join(siteDir, "results", "r")).filter((name) => name.endsWith(".html")).map((name) => name.replace(/\.html$/, "")).sort();
if (ids.length === 0) throw new Error("no result permalink pages were built");
const samples = [ids[0], ids.find((id) => id.startsWith("tpch-duckdb-sf1.0-")) ?? ids[1], ids.at(-1)].filter((id, index, all) => id && all.indexOf(id) === index);

const failures = [];
const report = { pages: ids.length, samples: {} };
const fail = (message) => failures.push(message);

const { server } = await startSiteServer(siteDir, dataDir);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

for (const id of samples) {
  const route = `/results/r/${id}`;
  const plain = await browser.newContext({ javaScriptEnabled: false });
  const plainPage = await plain.newPage();
  const plainResponse = await plainPage.goto(base + route, { waitUntil: "load" });
  const plainText = await plainPage.locator("main").innerText();
  const receiptVisible = await plainPage.locator("#run-receipt").isVisible();
  const anchored = await plainPage.goto(`${base}${route}#run-receipt`, { waitUntil: "load" }).then(() => plainPage.evaluate(() => window.location.hash));
  await plain.close();

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  const response = await page.goto(base + route, { waitUntil: "load" });
  await page.locator("main [data-static-result]").waitFor({ state: "detached", timeout: 60000 }).catch(() => null);
  const heading = page.getByRole("heading", { level: 1 }).first();
  await heading.waitFor({ state: "visible", timeout: 60000 }).catch(() => null);
  const explorerReceipt = await page.locator("#run-receipt").first().waitFor({ state: "visible", timeout: 60000 }).then(() => true).catch(() => false);
  const enhanced = (await page.locator("main [data-static-result]").count()) === 0;
  const landed = new URL(page.url());
  if (shotDir) {
    mkdirSync(shotDir, { recursive: true });
    await page.screenshot({ path: path.join(shotDir, `${id}.png`), fullPage: false });
  }
  await context.close();

  report.samples[id] = {
    plainStatus: plainResponse?.status(),
    plainHasId: plainText.includes(id),
    receiptVisibleWithoutJs: receiptVisible,
    hashKept: anchored,
    status: response?.status(),
    landed: landed.pathname,
    explorerReplacedStaticPage: enhanced,
    explorerReceipt,
    pageErrors,
  };
  if (plainResponse?.status() !== 200) fail(`${route} answered ${plainResponse?.status()} without JavaScript`);
  if (!plainText.includes(id) || !plainText.includes("Ranking status") || !plainText.includes("Cite as:")) fail(`${route} does not state the receipt without JavaScript`);
  if (!receiptVisible || anchored !== "#run-receipt") fail(`${route}#run-receipt does not land on the receipt without JavaScript`);
  if (response?.status() !== 200) fail(`${route} answered ${response?.status()} with JavaScript`);
  if (landed.pathname !== route) fail(`${route} landed on ${landed.pathname}`);
  if (!enhanced || !explorerReceipt) fail(`${route} was not enhanced by the Explorer`);
  if (pageErrors.length > 0) fail(`${route} raised page errors: ${pageErrors.join(" | ")}`);
}

const unknown = await fetch(`${base}/results/r/no-such-result-00000000`);
const unknownBody = await unknown.text();
report.unknown = { status: unknown.status, servesFallback: unknownBody.includes("benchbox.results.redirect") };
if (unknown.status !== 404) fail(`an unknown result id answered ${unknown.status}`);
if (!unknownBody.includes("benchbox.results.redirect")) fail("an unknown result id no longer reaches the Explorer's deep-link fallback");

const passes = await fetch(`${base}/results/r/${samples[0]}/passes`);
report.passes = { status: passes.status };
if (passes.status !== 404 || !(await passes.text()).includes("benchbox.results.redirect")) fail("a nested Explorer route under a result no longer reaches the deep-link fallback");

await browser.close();
server.close();
console.log(JSON.stringify(report, null, 2));
if (failures.length > 0) {
  console.error(`FAILED:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("permalink e2e passed");
