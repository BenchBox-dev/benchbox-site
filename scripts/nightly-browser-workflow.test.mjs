import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const path = new URL("../.github/workflows/nightly-browser.yml", import.meta.url);
const text = readFileSync(path, "utf8");
const workflow = parse(text);
const explorer = JSON.parse(readFileSync(fileURLToPath(new URL("../explorer/package.json", import.meta.url)), "utf8"));

test("runs on a schedule and on dispatch", () => {
  assert.equal(workflow.on.schedule.length, 1);
  assert.ok("workflow_dispatch" in workflow.on);
});

test("covers Firefox and WebKit without cancelling the other leg", () => {
  const { strategy } = workflow.jobs.browser;
  assert.deepEqual(strategy.matrix.browser, ["firefox", "webkit"]);
  assert.equal(strategy["fail-fast"], false);
});

test("every matrix browser has an Explorer smoke script", () => {
  for (const browser of workflow.jobs.browser.strategy.matrix.browser) {
    assert.ok(explorer.scripts[`test:e2e:${browser}`], browser);
  }
  const run = workflow.jobs.browser.steps.map((step) => step.run ?? "").join("\n");
  assert.match(run, /test:e2e:\$\{\{ matrix\.browser \}\} -w explorer/);
  assert.match(run, /playwright install --with-deps \$\{\{ matrix\.browser \}\}/);
});

test("every action is pinned to a commit SHA", () => {
  const uses = [...text.matchAll(/uses:\s*(\S+)/g)].map((match) => match[1]);
  assert.ok(uses.length > 0);
  for (const reference of uses) assert.match(reference, /@[0-9a-f]{40}$/);
});

test("failures open or update one t3:browser issue and write nothing else", () => {
  const { report } = workflow.jobs;
  assert.equal(report.needs, "browser");
  assert.match(report.if, /needs\.browser\.result == 'failure'/);
  assert.deepEqual(report.permissions, { contents: "read", issues: "write" });
  const script = report.steps.map((step) => step.run ?? "").join("\n");
  assert.match(script, /--label t3:browser --state open/);
  assert.match(script, /gh issue comment/);
  assert.match(script, /gh issue create/);
  assert.equal(workflow.permissions.issues, undefined);
});
