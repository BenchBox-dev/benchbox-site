#!/usr/bin/env node
import { pathToFileURL } from "node:url";

export const ROUTE_CLASSES = [
  { name: "landing", path: "/" },
  { name: "docs", path: "/docs/" },
  { name: "docs-dev", path: "/docs/dev/" },
  { name: "blog", path: "/blog/" },
  { name: "results", path: "/results/" },
  { name: "not-found", path: "/404.html" },
  { name: "inventory", path: "/docs/objects.inv" },
];

export async function probeRoutes(origin, fetchImpl = fetch) {
  const results = [];
  for (const route of ROUTE_CLASSES) {
    const url = new URL(route.path, origin).href;
    try {
      const response = await fetchImpl(url, { redirect: "follow" });
      results.push({ ...route, url, status: response.status, ok: response.status === 200 });
    } catch (error) {
      results.push({ ...route, url, status: 0, ok: false, error: String(error) });
    }
  }
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origin = process.argv[2] ?? process.env.SITE_ORIGIN;
  if (!origin) {
    console.error("probe-routes: pass the site origin or set SITE_ORIGIN");
    process.exit(2);
  }
  const results = await probeRoutes(origin);
  for (const result of results) console.log(`${result.ok ? "ok  " : "FAIL"} ${result.status} ${result.url}${result.error ? ` (${result.error})` : ""}`);
  process.exit(results.every((result) => result.ok) ? 0 : 1);
}
