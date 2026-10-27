import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, targetOf, disallowedFailures, mergeReports } from "./check-published-links.mjs";

const ALLOWANCE = [["/docs/a.html", "/docs/b.html#gone", "missing fragment"]];

function report(errors, extra = {}) {
  const error_map = {};
  for (const [source, url] of errors) (error_map[source] ??= []).push({ url, status: { text: "Error", details: "Cannot find fragment" } });
  return { total: 10, unique: 8, successful: 10 - errors.length, errors: errors.length, timeouts: 0, error_map, timeout_map: {}, ...extra };
}

test("targets keep the decoded path and fragment", () => {
  assert.equal(targetOf("https://benchbox.dev/docs/b.html#gone"), "/docs/b.html#gone");
  assert.equal(targetOf("https://benchbox.dev/docs/a%20b.html#x%2Dy"), "/docs/a b.html#x-y");
  assert.equal(targetOf("https://benchbox.dev/docs/"), "/docs/");
});

test("allowed targets pass whichever page links them", () => {
  const result = evaluate(report([["https://benchbox.dev/docs/c.html", "https://benchbox.dev/docs/b.html#gone"]]), ALLOWANCE);
  assert.equal(result.ok, true);
});

test("a missing fragment, a missing page and a timeout outside the allowance fail", () => {
  const input = report(
    [
      ["https://benchbox.dev/docs/a.html", "https://benchbox.dev/docs/b.html#other"],
      ["https://benchbox.dev/docs/a.html", "https://benchbox.dev/docs/missing.html"],
    ],
    { timeout_map: { "https://benchbox.dev/docs/a.html": [{ url: "https://benchbox.dev/docs/slow.html", status: { text: "Timeout" } }] } },
  );
  const failures = disallowedFailures(input, ALLOWANCE);
  assert.deepEqual(failures.map((failure) => failure.target), ["/docs/b.html#other", "/docs/missing.html", "/docs/slow.html"]);
  const result = evaluate(input, ALLOWANCE);
  assert.equal(result.ok, false);
  assert.match(result.text, /3 failures are not in inventory\/known-broken-links\.json/);
});

test("a run that checked nothing is a failure", () => {
  const result = evaluate({ total: 0, unique: 0, successful: 0, errors: 0, timeouts: 0 }, ALLOWANCE);
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems, ["lychee checked no links"]);
});

test("batch reports merge into one verdict", () => {
  const first = report([["https://benchbox.dev/docs/a.html", "https://benchbox.dev/docs/b.html#gone"]]);
  const second = report([["https://benchbox.dev/docs/c.html", "https://benchbox.dev/docs/missing.html"]]);
  const merged = mergeReports([first, second]);
  assert.equal(merged.total, 20);
  assert.equal(merged.errors, 2);
  const result = evaluate(merged, ALLOWANCE);
  assert.equal(result.ok, false);
  assert.deepEqual(result.failures.map((failure) => failure.target), ["/docs/missing.html"]);
});
