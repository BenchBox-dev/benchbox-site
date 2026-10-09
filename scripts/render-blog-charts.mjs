#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Convert from "ansi-to-html";
import { chromium } from "@playwright/test";
import { siteInputsDir } from "./bundle-lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CHARTS_DIR = path.join(REPO_ROOT, "drafts", "charts");
const PRIMARY_OUT = path.join(REPO_ROOT, "drafts", "building-benchbox", "images");
const PUBLISHED_OUT = path.join(REPO_ROOT, "blog", "images");

const PALETTE = {
  0: "#1a1e24",
  1: "#f44747",
  2: "#4ec9b0",
  3: "#e6ab02",
  4: "#569cd6",
  5: "#c586c0",
  6: "#4ec9b0",
  7: "#d4d4d4",
};

export const PAGE_STYLE = `
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { background: #1a1e24; }
body { padding: 28px 32px; display: inline-block; min-width: 860px; }
pre { font-family: "Fira Code", "Menlo", "JetBrains Mono", "SF Mono", "Consolas", monospace; font-size: 13.5px; line-height: 1.0; color: #d4d4d4; white-space: pre; }
`;

export function benchboxVersion() {
  return JSON.parse(readFileSync(path.join(siteInputsDir(), "manifest.json"), "utf8")).package_version;
}

export function chartCommand(chart, version, dataDir = path.join(CHARTS_DIR, "data")) {
  const args = chart.command.map((arg) => arg.replaceAll("{data}", dataDir));
  return ["uvx", ["--from", `benchbox==${version}`, ...args]];
}

export function ansiToPage(ansi) {
  const body = new Convert({ fg: "#d4d4d4", bg: "#1a1e24", colors: PALETTE, escapeXML: true }).toHtml(ansi);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${PAGE_STYLE}</style></head><body><pre>${body}</pre></body></html>`;
}

export function parseArgs(argv) {
  const options = { names: [], outDir: PRIMARY_OUT, publish: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--publish") options.publish = true;
    else if (argv[index] === "--out-dir") options.outDir = path.resolve(argv[++index]);
    else options.names.push(argv[index]);
  }
  return options;
}

async function render({ names, outDir, publish }) {
  const version = benchboxVersion();
  const { charts } = JSON.parse(readFileSync(path.join(CHARTS_DIR, "charts.json"), "utf8"));
  const selected = names.length > 0 ? charts.filter((chart) => names.includes(chart.name)) : charts;
  if (selected.length === 0) throw new Error(`no chart named ${names.join(", ")}`);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 }, deviceScaleFactor: 1 });
    for (const chart of selected) {
      const [command, args] = chartCommand(chart, version);
      const ansi = execFileSync(command, args, {
        encoding: "utf8",
        env: { ...process.env, FORCE_COLOR: "1", TERM: "xterm-256color" },
      }).trim();
      if (!ansi) throw new Error(`${chart.name} produced no output`);
      await page.setContent(ansiToPage(ansi), { waitUntil: "load" });
      mkdirSync(outDir, { recursive: true });
      const out = path.join(outDir, `${chart.name}.png`);
      await page.locator("body").screenshot({ path: out });
      if (publish) copyFileSync(out, path.join(PUBLISHED_OUT, `${chart.name}.png`));
      console.log(`rendered ${chart.name} with benchbox ${version}`);
    }
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  render(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(`render-blog-charts: ${error.message}`);
    process.exit(1);
  });
}
