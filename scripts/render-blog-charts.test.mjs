import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ansiToPage, benchboxVersion, chartCommand, docsInputsDir, parseArgs } from "./render-blog-charts.mjs";

const pin = path.resolve(import.meta.dirname, "..", "release-pin");

test("the chart CLI version comes from the release pin, not SITE_INPUTS", () => {
  const expected = JSON.parse(readFileSync(path.join(pin, "manifest.json"), "utf8")).package_version;
  assert.equal(docsInputsDir({ SITE_INPUTS: "/elsewhere" }), pin);
  assert.equal(docsInputsDir({ DOCS_INPUTS: "" }), pin);
  assert.equal(benchboxVersion({ SITE_INPUTS: "/elsewhere" }), expected);
});

test("DOCS_INPUTS overrides the pin", () => {
  assert.equal(docsInputsDir({ DOCS_INPUTS: "/custom" }), "/custom");
});

test("charts run the published CLI pinned to the docs inputs version", () => {
  const [command, args] = chartCommand({ name: "x", command: ["textcharts", "bar", "-f", "{data}/x.json"] }, "0.4.2", "/data");
  assert.equal(command, "uvx");
  assert.deepEqual(args, ["--from", "benchbox==0.4.2", "textcharts", "bar", "-f", "/data/x.json"]);
});

test("ANSI output becomes an escaped page", () => {
  const page = ansiToPage("\u001b[32mok\u001b[0m <b>");
  assert.match(page, /<pre>.*ok.*&lt;b&gt;<\/pre>/s);
});

test("rendering publishes only when asked", () => {
  assert.equal(parseArgs(["a"]).publish, false);
  assert.deepEqual(parseArgs(["--publish", "a", "b"]).names, ["a", "b"]);
  assert.equal(parseArgs(["--publish"]).publish, true);
});
