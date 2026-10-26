import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const siteDir = path.resolve(process.env.SITE_DIR ?? path.join(repoRoot, "website", "dist"));
const inventory = JSON.parse(readFileSync(path.join(repoRoot, "inventory", "legacy-downloads.json"), "utf-8"));
const blob = (sha, file) => `https://github.com/BenchBox-dev/BenchBox/blob/${sha}/${file}`;
const legacyUrl = (source) => `/docs/_downloads/${createHash("md5").update(source).digest("hex")}/${path.posix.basename(source)}`;

function serveAsPages(root) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const full = path.join(root, relative);
    if (!full.startsWith(root)) {
      response.writeHead(400).end();
      return;
    }
    if (existsSync(full) && statSync(full).isDirectory() && !url.pathname.endsWith("/")) {
      response.writeHead(301, { location: `${url.pathname}/${url.search}` }).end();
      return;
    }
    const file = existsSync(full) && statSync(full).isDirectory() ? path.join(full, "index.html") : full;
    if (!existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, { "content-type": "text/html; charset=utf-8" }).end("not found");
      return;
    }
    response.writeHead(200, { "content-type": file.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const byExtension = new Map();
for (const download of inventory.downloads) {
  const extension = path.extname(download.source);
  if (!byExtension.has(extension) || (download.notice !== undefined && byExtension.get(extension).notice === undefined)) byExtension.set(extension, download);
}
const samples = [...byExtension.values()];
const sidecarOwner = inventory.downloads.find((download) => download.notice !== undefined);

const server = await serveAsPages(siteDir);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const failures = [];
const report = [];

async function navigate(route, expectedTarget, label) {
  for (const prefix of ["", "/docs/dev"]) {
    const served = prefix === "" ? route : route.replace(/^\/docs\//, `${prefix}/`);
    const context = await browser.newContext();
    await context.route("https://github.com/**", (handler) => handler.fulfill({ status: 200, contentType: "text/html", body: "<title>github stub</title>" }));
    const page = await context.newPage();
    const documentLoads = [];
    page.on("response", (response) => {
      if (response.request().isNavigationRequest()) documentLoads.push({ url: response.url(), status: response.status(), type: response.headers()["content-type"] });
    });
    await page.goto(base + served, { waitUntil: "load" });
    await page.waitForURL(expectedTarget, { timeout: 15000 }).catch(() => undefined);
    const local = documentLoads.filter((entry) => entry.url.startsWith(base));
    const ok =
      page.url() === expectedTarget &&
      local[0]?.status === 301 &&
      local[1]?.status === 200 &&
      String(local[1]?.type).startsWith("text/html");
    report.push({ label, served, finalUrl: page.url(), local, ok });
    if (!ok) failures.push(`${label} ${served}`);
    await context.close();
  }
}

for (const download of samples) {
  await navigate(legacyUrl(download.source), blob(download.core_sha ?? inventory.core_sha, download.path), `download ${path.extname(download.source)}`);
  if (download.notice !== undefined) {
    const html = await (await fetch(base + legacyUrl(download.source))).text();
    const linked = html.includes(`<a href="${blob(inventory.core_sha, download.notice)}">TPC End User License Agreement</a>`);
    report.push({ label: "template page links the adjacent TPC notice", source: download.source, ok: linked });
    if (!linked) failures.push(`notice link ${download.source}`);
  }
}
if (sidecarOwner !== undefined) {
  const sidecar = `${path.posix.dirname(legacyUrl(sidecarOwner.source))}/TPC_EULA.txt`;
  await navigate(sidecar, blob(inventory.core_sha, sidecarOwner.notice), "sidecar TPC_EULA.txt");
}

await browser.close();
server.close();
console.log(JSON.stringify(report, null, 2));
if (failures.length > 0) {
  console.error(`FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("legacy downloads e2e passed");
