import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { filesUnder } from "../gates/files.ts";

export const ROUTE_ROOTS = ["index.html", "docs/index.html", "docs/dev/index.html", "blog/index.html", "results/index.html", "404.html"];
export const REQUIRED_PATHS = [...ROUTE_ROOTS, "results/data/results.duckdb", "docs/objects.inv"];
const SAMPLED = /\.(html|css|js|svg|json|xml)$/;
export const DEEP_LINK = "/results/__site_deploy_probe__/deep/link";

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
  return manifest;
}

export type ProbeOutcome = {
  ok: boolean;
  base_url: string;
  attempts: number;
  matched: number;
  mismatched: string[];
  errors: string[];
  deep_link: { ok: boolean; status: number };
};

type Fetch = (url: string) => Promise<{ status: number; body: Uint8Array }>;

export async function fetchBytes(url: string): Promise<{ status: number; body: Uint8Array }> {
  const response = await fetch(url, { redirect: "follow", headers: { "User-Agent": "benchbox-site-deploy-probe/1.0" } });
  return { status: response.status, body: new Uint8Array(await response.arrayBuffer()) };
}

export async function probeOnce(baseUrl: string, manifest: Record<string, string>, fetchImpl: Fetch = fetchBytes): Promise<Omit<ProbeOutcome, "attempts">> {
  const mismatched: string[] = [];
  const errors: string[] = [];
  let matched = 0;
  for (const [url, expected] of Object.entries(manifest).sort()) {
    try {
      const { status, body } = await fetchImpl(new URL(url, baseUrl).href);
      if (status < 200 || status >= 300) {
        errors.push(`${url}: HTTP ${status}`);
        continue;
      }
      const actual = createHash("sha256").update(body).digest("hex");
      if (actual.toLowerCase() === expected.toLowerCase()) matched += 1;
      else mismatched.push(url);
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
  return { ok: mismatched.length === 0 && errors.length === 0 && deepLink.ok, base_url: baseUrl, matched, mismatched, errors, deep_link: deepLink };
}

export async function probe(
  baseUrl: string,
  manifest: Record<string, string>,
  options: { attempts?: number; delayMs?: number; fetchImpl?: Fetch } = {},
): Promise<ProbeOutcome> {
  const attempts = options.attempts ?? 6;
  let last: Omit<ProbeOutcome, "attempts"> | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await probeOnce(baseUrl, manifest, options.fetchImpl);
    if (last.ok) return { ...last, attempts: attempt };
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 10_000));
  }
  return { ...(last as Omit<ProbeOutcome, "attempts">), attempts };
}
