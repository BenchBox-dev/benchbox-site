import { test } from "node:test";
import assert from "node:assert/strict";
import { ansiToPage, chartCommand, parseArgs } from "./render-blog-charts.mjs";

test("charts run the published CLI pinned to the bundle version", () => {
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
