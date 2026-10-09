import { test } from "node:test";
import assert from "node:assert/strict";
import { compareCaptures, summaryMarkdown } from "./visual-diff.mjs";

const capture = (route, width, digest) => ({ route, viewport_width: width, digest, filename: `${route.replace(/\W+/g, "") || "landing"}-${width}.png` });

test("captures are matched by route and width and sorted into same, changed, added and removed", () => {
  const deployed = { captures: [capture("/", 390, "a"), capture("/results/", 390, "b"), capture("/old/", 390, "c")] };
  const pr = { captures: [capture("/", 390, "a"), capture("/results/", 390, "B"), capture("/new/", 390, "d")] };
  const report = compareCaptures(deployed, pr);
  assert.deepEqual(report.same, ["/@390"]);
  assert.deepEqual(report.changed.map((entry) => entry.name), ["/results/@390"]);
  assert.deepEqual(report.added.map((entry) => entry.name), ["/new/@390"]);
  assert.deepEqual(report.removed.map((entry) => entry.name), ["/old/@390"]);
});

test("the summary lists each difference and says the check is advisory", () => {
  const report = compareCaptures({ captures: [capture("/", 390, "a")] }, { captures: [capture("/", 390, "b")] });
  const summary = summaryMarkdown(report, "123");
  assert.match(summary, /run 123/);
  assert.match(summary, /advisory/);
  assert.match(summary, /\| \/@390 \| changed \|/);
  assert.doesNotMatch(summaryMarkdown(compareCaptures({ captures: [] }, { captures: [] }), "1"), /\| Capture/);
});
