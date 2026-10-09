import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checksumManifest, probe, probeOnce, servedUrl } from "../lib/probe.ts";
import { addNoindex, markRehearsal, NOINDEX, REHEARSAL_ROBOTS } from "../lib/rehearsal.ts";
import { site } from "./helpers.ts";

test("rehearsal pages get noindex once and robots.txt disallows everything", () => {
  assert.equal(addNoindex("<html><head><title>x</title></head></html>"), `<html><head>${NOINDEX}<title>x</title></head></html>`);
  assert.equal(addNoindex(addNoindex("<html><head></head></html>")), `<html><head>${NOINDEX}</head></html>`);
  const dir = site({ "index.html": "<html><head></head></html>", "docs/a.html": '<html><head lang="en"></head></html>', "robots.txt": "Allow: /" });
  assert.equal(markRehearsal(dir), 2);
  assert.equal(readFileSync(path.join(dir, "robots.txt"), "utf8"), REHEARSAL_ROBOTS);
});

const REQUIRED = {
  "index.html": "home",
  "docs/index.html": "docs",
  "docs/dev/index.html": "dev",
  "blog/index.html": "blog",
  "results/index.html": "results",
  "404.html": "benchbox.results.redirect",
  "results/data/results.duckdb": "db",
  "docs/objects.inv": "inv",
};

test("the probe manifest covers every route class and samples more files", () => {
  const manifest = checksumManifest(site({ ...REQUIRED, "docs/a.html": "a", "assets/x.css": "x" }));
  for (const file of Object.keys(REQUIRED)) assert.ok(servedUrl(file) in manifest, file);
  assert.ok("/docs/a.html" in manifest);
  assert.throws(() => checksumManifest(site({ "index.html": "home" })), /required probe paths/);
});

function fakeFetch(served: Record<string, { status: number; body: string }>) {
  return async (url: string) => {
    const entry = served[new URL(url).pathname] ?? { status: 404, body: "benchbox.results.redirect" };
    return { status: entry.status, body: new TextEncoder().encode(entry.body) };
  };
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

test("the probe compares served bytes with the artifact", async () => {
  const manifest = { "/": sha("home"), "/docs/": sha("docs") };
  const ok = await probeOnce("https://site.test", manifest, fakeFetch({ "/": { status: 200, body: "home" }, "/docs/": { status: 200, body: "docs" } }));
  assert.equal(ok.ok, true);
  assert.equal(ok.matched, 2);
  const tampered = await probeOnce("https://site.test", manifest, fakeFetch({ "/": { status: 200, body: "home" }, "/docs/": { status: 200, body: "changed" } }));
  assert.deepEqual(tampered.mismatched, ["/docs/"]);
  const down = await probeOnce("https://site.test", manifest, fakeFetch({ "/": { status: 503, body: "" }, "/docs/": { status: 200, body: "docs" } }));
  assert.deepEqual(down.errors, ["/: HTTP 503"]);
});

test("the deep link must fall back to the results redirect page", async () => {
  const served = { "/": { status: 200, body: "home" }, "/results/__site_deploy_probe__/deep/link": { status: 200, body: "oops" } };
  const outcome = await probeOnce("https://site.test", { "/": sha("home") }, fakeFetch(served));
  assert.equal(outcome.ok, false);
  assert.deepEqual(outcome.deep_link, { ok: false, status: 200 });
});

test("the probe retries until the site serves the artifact", async () => {
  let calls = 0;
  const flaky = async (url: string) => {
    calls += 1;
    if (new URL(url).pathname === "/") return { status: calls < 3 ? 503 : 200, body: new TextEncoder().encode("home") };
    return { status: 404, body: new TextEncoder().encode("benchbox.results.redirect") };
  };
  const outcome = await probe("https://site.test", { "/": sha("home") }, { attempts: 4, delayMs: 0, fetchImpl: flaky });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.attempts, 2);
  const never = await probe("https://site.test", { "/": sha("home") }, { attempts: 2, delayMs: 0, fetchImpl: fakeFetch({ "/": { status: 500, body: "" } }) });
  assert.equal(never.ok, false);
  assert.equal(never.attempts, 2);
});
