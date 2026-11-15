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

function evaluate(source, context) {
  const inner = source.trim().match(/^\$\{\{([\s\S]*)\}\}$/);
  assert.ok(inner, `not an expression: ${source}`);
  const tokens = inner[1].match(/'(?:[^']|'')*'|[A-Za-z_][\w.]*|==|&&|\|\||[(),]/g);
  assert.equal(tokens.join(""), inner[1].replace(/\s+(?=(?:[^']*'[^']*')*[^']*$)/g, ""), "unrecognised characters");
  let at = 0;
  const peek = () => tokens[at];
  const take = (expected) => {
    const token = tokens[at++];
    assert.ok(expected === undefined || token === expected, `expected ${expected}, got ${token}`);
    return token;
  };
  const truthy = (value) => value !== "" && value !== false;
  const primary = () => {
    const token = take();
    if (token === "(") {
      const value = or();
      take(")");
      return value;
    }
    if (token.startsWith("'")) return token.slice(1, -1).replaceAll("''", "'");
    if (token === "format") {
      take("(");
      const template = or();
      const args = [];
      while (peek() === ",") {
        take(",");
        args.push(or());
      }
      take(")");
      return template.replace(/\{(\d+)\}/g, (_, index) => args[Number(index)]);
    }
    assert.ok(token in context, `unknown context value ${token}`);
    return context[token];
  };
  const equality = () => {
    let left = primary();
    while (peek() === "==") {
      take();
      left = left.toLowerCase() === primary().toLowerCase();
    }
    return left;
  };
  const and = () => {
    let left = equality();
    while (peek() === "&&") {
      take();
      const right = equality();
      left = truthy(left) ? right : left;
    }
    return left;
  };
  function or() {
    let left = and();
    while (peek() === "||") {
      take();
      const right = and();
      left = truthy(left) ? left : right;
    }
    return left;
  }
  const value = or();
  assert.equal(at, tokens.length, "trailing tokens");
  return typeof value === "boolean" ? String(value) : value;
}

const workspace = "/work/site";
const bundle = `${workspace}/.site-inputs`;
const contexts = [
  ["pull request into main", { "github.base_ref": "main", "github.ref": "refs/pull/7/merge" }, ""],
  ["pull request into next", { "github.base_ref": "next", "github.ref": "refs/pull/7/merge" }, bundle],
  ["push to main", { "github.base_ref": "", "github.ref": "refs/heads/main" }, ""],
  ["push to next", { "github.base_ref": "", "github.ref": "refs/heads/next" }, bundle],
  ["workflow_dispatch on main", { "github.base_ref": "", "github.ref": "refs/heads/main" }, ""],
  ["workflow_dispatch on next", { "github.base_ref": "", "github.ref": "refs/heads/next" }, bundle],
  ["release pull request from next into main", { "github.base_ref": "main", "github.ref": "refs/pull/9/merge" }, ""],
];

test("ci DOCS_INPUTS selects the develop bundle for next and the pin otherwise", () => {
  for (const [name, context, expected] of contexts) {
    assert.equal(evaluate(ci.env.DOCS_INPUTS, { ...context, "github.workspace": workspace }), expected, name);
  }
});

test("visual DOCS_INPUTS selects the develop bundle only for pull requests into next", () => {
  const visual = parse(read("visual.yml"));
  for (const [name, context] of contexts) {
    const expected = context["github.base_ref"] === "next" ? bundle : "";
    assert.equal(evaluate(visual.env.DOCS_INPUTS, { ...context, "github.workspace": workspace }), expected, name);
  }
});

test("on next the checks job also assembles the docs against the pin", () => {
  const steps = ci.jobs.checks.steps;
  const command = "npm run docs:assemble -w website";
  const matching = steps.filter((candidate) => (candidate.run ?? "").includes(command));
  assert.equal(matching.length, 1);
  const [step] = matching;
  assert.equal(step.if, "env.DOCS_INPUTS != ''");
  assert.equal(step.env, undefined);
  assert.equal(step.run, `DOCS_INPUTS= ${command}`);
  assert.ok(!steps.some((candidate) => /docs:check/.test(candidate.run ?? "") && /DOCS_INPUTS=/.test(candidate.run ?? "")));
  assert.ok(steps.indexOf(step) < steps.findIndex((candidate) => candidate.run === "npm run build"));
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
