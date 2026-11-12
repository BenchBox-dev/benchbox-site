import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const read = (name) => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");
const ci = parse(read("ci.yml"));
const nightly = parse(read("nightly.yml"));

test("ci runs on pushes to main and next", () => {
  assert.ok(ci.on.push.branches.includes("main"));
  assert.ok(ci.on.push.branches.includes("next"));
});

test("DOCS_INPUTS selects the bundle only for next", () => {
  const expression = ci.env.DOCS_INPUTS;
  assert.ok(expression.includes("github.base_ref == 'next'"));
  assert.ok(expression.includes("refs/heads/next"));
  assert.ok(expression.includes(".site-inputs"));
});

test("the checks job verifies the pin", () => {
  const step = ci.jobs.checks.steps.find((candidate) => candidate.run === "npm run docs:pin -- --check");
  assert.ok(step);
  assert.equal(step.env.GH_TOKEN, "${{ github.token }}");
});

test("the aggregate ci job needs every other job", () => {
  const others = Object.keys(ci.jobs).filter((name) => name !== "ci").sort();
  assert.deepEqual([...ci.jobs.ci.needs].sort(), others);
});

test("deploy builds from the pin", () => {
  assert.ok(!read("deploy.yml").includes("DOCS_INPUTS"));
});

test("visual applies the same rule to pull requests into next", () => {
  const visual = parse(read("visual.yml"));
  assert.ok(visual.env.DOCS_INPUTS.includes("github.base_ref == 'next'"));
});

test("the nightly reminder opens its issue only on exit code 1", () => {
  const job = nightly.jobs["docs-release-pending"];
  assert.equal(job.permissions.issues, "write");
  const check = job.steps.find((step) => step.id === "pending");
  assert.ok(check.run.includes("docs:pin -- --pending"));
  assert.ok(check.run.includes('exit "$code"'));
  const issue = job.steps.find((step) => (step.name ?? "").includes("issue"));
  assert.equal(issue.if, "steps.pending.outputs.code == '1'");
  assert.ok(issue.run.includes("--label docs-release-pending"));
  assert.ok(issue.run.includes("--force"));
});
