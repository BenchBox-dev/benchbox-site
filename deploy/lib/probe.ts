import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { filesUnder } from "../gates/files.ts";
import type { ProbeMismatch } from "./receipt.ts";

export const ROUTE_ROOTS = ["index.html", "docs/index.html", "docs/dev/index.html", "blog/index.html", "results/index.html", "404.html"];
export const REQUIRED_PATHS = [...ROUTE_ROOTS, "results/data/results.duckdb", "docs/objects.inv"];
const SAMPLED = /\.(html|css|js|svg|json|xml)$/;
export const DEEP_LINK = "/results/__site_deploy_probe__/deep/link";
const LEGACY_DOWNLOAD_PAGE = /^docs\/_downloads\/[0-9a-f]{32}\/([^/]+)\/index\.html$/;
const LEGACY_DOWNLOAD_URL = /^\/docs\/_downloads\/[0-9a-f]{32}\/[^/]+$/;

export function legacyDownloadSamples(files: readonly string[]): string[] {
  const byExtension = new Map<string, string>();
  for (const file of files) {
    const name = LEGACY_DOWNLOAD_PAGE.exec(file)?.[1];
    if (name !== undefined && !byExtension.has(path.extname(name))) byExtension.set(path.extname(name), file);
  }
  return [...byExtension.values()];
}

function legacyDownloadUrl(file: string): string {
  return `/${file.slice(0, -"/index.html".length)}`;
}

export function servedUrl(file: string): string {
  if (file === "index.html") return "/";
  if (file.endsWith("/index.html")) return `/${file.slice(0, -"index.html".length)}`;
  return `/${file}`;
}

export function checksumManifest(siteDir: string, samples = 25): Record<string, string> {
  const sha = (file: string) => createHash("sha256").update(readFileSync(path.join(siteDir, file))).digest("hex");
  const missing = REQUIRED_PATHS.filter((file) => !existsSync(path.join(siteDir, file)));
  if (missing.length > 0) throw new Error(`the artifact does not serve required probe paths: ${missing.join(", ")}`);
  const manifest: Record<string, string> = {};
  for (const file of REQUIRED_PATHS) manifest[servedUrl(file)] = sha(file);
  const candidates = filesUnder(siteDir).filter((file) => SAMPLED.test(file) && !REQUIRED_PATHS.includes(file));
  const stride = Math.max(1, Math.floor(candidates.length / samples));
  for (let index = 0; index < candidates.length && Object.keys(manifest).length < REQUIRED_PATHS.length + samples; index += stride) {
    manifest[servedUrl(candidates[index])] = sha(candidates[index]);
  }
  for (const file of legacyDownloadSamples(filesUnder(siteDir))) manifest[legacyDownloadUrl(file)] = sha(file);
  return manifest;
}

export type ProbeOutcome = {
  ok: boolean;
  base_url: string;
  attempts: number;
  matched: number;
  mismatched: string[];
  mismatch_details: ProbeMismatch[];
  errors: string[];
  deep_link: { ok: boolean; status: number };
};

type ProbeResponse = { status: number; body: Uint8Array; headers?: Record<string, string> };
type Fetch = (url: string) => Promise<ProbeResponse>;
const CACHE_HEADERS = ["age", "cache-control", "content-type", "date", "etag", "last-modified", "via", "x-cache", "x-cache-hits", "x-served-by", "x-proxy-cache"];

export async function fetchBytes(url: string): Promise<ProbeResponse> {
  const response = await fetch(url, { redirect: "follow", headers: { "User-Agent": "benchbox-site-deploy-probe/1.0" } });
  const headers: Record<string, string> = {};
  for (const name of CACHE_HEADERS) {
    const value = response.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  return { status: response.status, body: new Uint8Array(await response.arrayBuffer()), headers };
}

export async function probeOnce(baseUrl: string, manifest: Record<string, string>, fetchImpl: Fetch = fetchBytes): Promise<Omit<ProbeOutcome, "attempts">> {
  const mismatched: string[] = [];
  const mismatchDetails: ProbeMismatch[] = [];
  const errors: string[] = [];
  let matched = 0;
  for (const [url, expected] of Object.entries(manifest).sort()) {
    try {
      const { status, body, headers = {} } = await fetchImpl(new URL(url, baseUrl).href);
      if (status < 200 || status >= 300) {
        errors.push(`${url}: HTTP ${status}`);
        continue;
      }
      if (LEGACY_DOWNLOAD_URL.test(url) && !(headers["content-type"] ?? "").toLowerCase().startsWith("text/html")) {
        errors.push(`${url}: content type ${headers["content-type"] ?? "missing"} is not text/html`);
        continue;
      }
      const actual = createHash("sha256").update(body).digest("hex");
      if (actual.toLowerCase() === expected.toLowerCase()) matched += 1;
      else {
        mismatched.push(url);
        mismatchDetails.push({ url, expected_sha256: expected, served_sha256: actual, headers });
      }
    } catch (error) {
      errors.push(`${url}: ${String(error)}`);
    }
  }
  let deepLink = { ok: false, status: 0 };
  try {
    const { status, body } = await fetchImpl(new URL(DEEP_LINK, baseUrl).href);
    deepLink = { ok: status === 404 && new TextDecoder().decode(body).includes("benchbox.results.redirect"), status };
  } catch (error) {
    errors.push(`${DEEP_LINK}: ${String(error)}`);
  }
  return { ok: mismatched.length === 0 && errors.length === 0 && deepLink.ok, base_url: baseUrl, matched, mismatched, mismatch_details: mismatchDetails, errors, deep_link: deepLink };
}

export const PROBE_WINDOW_MS = 660_000;
export const PROBE_DELAY_MS = 10_000;

export type ProbeOptions = {
  windowMs?: number;
  delayMs?: number;
  fetchImpl?: Fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export async function probe(baseUrl: string, manifest: Record<string, string>, options: ProbeOptions = {}): Promise<ProbeOutcome> {
  const windowMs = options.windowMs ?? PROBE_WINDOW_MS;
  const delayMs = options.delayMs ?? PROBE_DELAY_MS;
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + windowMs;
  for (let attempt = 1; ; attempt += 1) {
    const outcome = await probeOnce(baseUrl, manifest, options.fetchImpl);
    if (outcome.ok) return { ...outcome, attempts: attempt };
    const remaining = deadline - now();
    if (remaining <= 0) return { ...outcome, attempts: attempt };
    await sleep(Math.min(delayMs, remaining));
  }
}
