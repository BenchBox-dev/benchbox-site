import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const workflow = parse(readFileSync(new URL("../.github/workflows/sync-next.yml", import.meta.url), "utf8"));
const job = workflow.jobs["next-behind-main"];
const script = job.steps.find((step) => step.run).run;

test("the reminder runs on pushes to main and next and on demand", () => {
  assert.deepEqual(workflow.on.push.branches, ["main", "next"]);
  assert.ok("workflow_dispatch" in workflow.on);
  assert.equal(Object.keys(workflow.on).length, 2);
});

test("permissions are read-only by default and the job adds only issues", () => {
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(job.permissions, { contents: "read", issues: "write" });
});

test("runs are serialised in one concurrency group that never cancels", () => {
  assert.equal(workflow.concurrency.group, "sync-next");
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
});

test("the checkout keeps no credentials and sees both branches", () => {
  const checkout = job.steps.find((step) => (step.uses ?? "").startsWith("actions/checkout@"));
  assert.equal(checkout.with["persist-credentials"], false);
  assert.equal(checkout.with["fetch-depth"], 0);
});

test("the workflow only reads branches and writes issues", () => {
  assert.ok(!/git push|git commit|git merge(?!-tree)|gh pr |--force-with-lease|push --force/.test(script));
  assert.ok(!/refs\/heads\/(next|main):/.test(script.replace(/'\+refs\/heads\/(next|main):refs\/remotes\/origin\/(next|main)'/g, "")));
  assert.ok(script.includes("git rev-list --count origin/next..origin/main"));
});

test("the issue is opened, updated and closed by label", () => {
  assert.ok(script.includes("--label next-behind-main"));
  assert.ok(script.includes("gh label create next-behind-main"));
  assert.ok(script.includes("gh issue close"));
  assert.ok(script.includes("gh issue edit"));
  assert.ok(script.includes("gh issue create"));
});

test("conflicting files are named from a merge that writes no ref", () => {
  assert.ok(script.includes("git merge-tree --write-tree --name-only --no-messages origin/next origin/main"));
});

test("a repository without a next branch exits quietly before fetching", () => {
  const probe = "git ls-remote --exit-code origin refs/heads/next > /dev/null || exit 0";
  assert.ok(script.includes(probe));
  assert.ok(script.indexOf(probe) < script.indexOf("git fetch"));
});

test("the issue tells a person to merge with gh pr merge --merge and next keeps its text", () => {
  assert.ok(script.includes("`gh pr merge --merge`, not a squash"));
  assert.ok(script.includes("`next` keeps its text"));
});
