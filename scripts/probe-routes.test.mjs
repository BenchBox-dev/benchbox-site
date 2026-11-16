import assert from "node:assert/strict";
import { test } from "node:test";
import { probeRoutes, ROUTE_CLASSES } from "./probe-routes.mjs";

const respond = (status, contentType) => ({ status, headers: new Headers(contentType ? { "content-type": contentType } : {}) });

function serve(overrides = {}) {
  return async (url) => {
    const pathname = new URL(url).pathname;
    if (Object.hasOwn(overrides, pathname)) return overrides[pathname];
    if (pathname === "/llms.txt") return respond(200, "text/plain; charset=utf-8");
    if (pathname.endsWith(".md")) return respond(200, "text/markdown; charset=utf-8");
    return respond(200, "text/html");
  };
}

test("every route class passes when llms.txt is text and the Markdown page is served", async () => {
  const results = await probeRoutes("https://site.test", serve());
  assert.equal(results.length, ROUTE_CLASSES.length);
  assert.ok(results.every((result) => result.ok));
  assert.ok(results.some((result) => result.url === "https://site.test/llms.txt"));
});

test("a missing llms.txt fails the probe", async () => {
  const results = await probeRoutes("https://site.test", serve({ "/llms.txt": respond(404, "text/html") }));
  assert.equal(results.find((result) => result.name === "llms").ok, false);
});

test("llms.txt served as html fails the probe", async () => {
  const results = await probeRoutes("https://site.test", serve({ "/llms.txt": respond(200, "text/html") }));
  const llms = results.find((result) => result.name === "llms");
  assert.equal(llms.ok, false);
  assert.match(llms.error, /content type text\/html/);
});

test("a Markdown page served as html fails the probe", async () => {
  const results = await probeRoutes("https://site.test", serve({ "/docs/usage/installation.md": respond(200, "text/html") }));
  assert.equal(results.find((result) => result.name === "docs-markdown").ok, false);
});
