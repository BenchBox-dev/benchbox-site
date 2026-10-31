import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = fileURLToPath(new URL("../../", import.meta.url));
const workflow = parse(readFileSync(join(root, ".github/workflows/deploy.yml"), "utf8"));

const stub = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(process.env.GH_STATE, 'utf8'));
state.calls.push(args);
const option = (name) => args[args.indexOf(name) + 1];
const [resource, action] = args;
let result = '';
if (resource === 'label') {
  if (process.env.FAIL_LABEL === 'true') process.exit(17);
} else if (action === 'list') {
  const issues = state.issues.filter(issue => issue.open && issue.label === option('--label'));
  result = args.includes('--jq') ? String(issues[0]?.number || '') : JSON.stringify(issues);
} else if (action === 'create') {
  const issue = { number: 100 + state.issues.length, label: option('--label'), body: option('--body'), comments: [], open: true };
  state.issues.push(issue);
  result = 'https://github.com/BenchBox-dev/BenchBox/issues/' + issue.number;
} else {
  const issue = state.issues.find(issue => issue.number === Number(args[2]));
  if (action === 'view') result = JSON.stringify(issue);
  else if (action === 'comment') issue.comments.push({ body: option('--body') });
  else if (action === 'close') { issue.open = false; issue.comments.push({ body: option('--comment') }); }
  else process.exit(18);
}
fs.writeFileSync(process.env.GH_STATE, JSON.stringify(state));
process.stdout.write(result);
`;

test("gh process smoke preserves creation body through A B B A, closes only relay and skips markers", () => {
  const dir = mkdtempSync(join(tmpdir(), "site-relay-"));
  try {
    writeFileSync(join(dir, "gh"), stub);
    chmodSync(join(dir, "gh"), 0o755);
    const statePath = join(dir, "state.json");
    writeFileSync(statePath, JSON.stringify({ calls: [], issues: [{ number: 99, label: "site-bundle-failed", body: "unrelated", comments: [], open: true }] }));
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, GH_STATE: statePath, CORE_SHA: "abc123", GH_TOKEN: "stub", EXPECTED_REJECTION: "false" };
    const run = (mode: string, error: string, extra = {}) => spawnSync(process.execPath, ["--experimental-strip-types", join(root, "deploy/relay-cli.ts"), mode], { env: { ...env, ERROR_TEXT: error, ...extra }, encoding: "utf8" });
    for (const [text, action] of [["producing run concluded null", "created"], ["snapshot_digest changed", "commented"], ["snapshot_digest changed", "no_change"], ["producing run concluded null", "commented"]]) {
      const result = run("fail", text);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, new RegExp(action));
    }
    let state = JSON.parse(readFileSync(statePath, "utf8"));
    const relay = state.issues[1];
    assert.match(relay.body, /producer-not-concluded/);
    assert.equal(relay.comments.length, 2);
    assert.match(relay.comments[0].body, /snapshot-digest/);
    assert.match(relay.comments[1].body, /producer-not-concluded/);
    assert.equal(run("success", "").status, 0);
    state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.issues[0].open, true);
    assert.equal(state.issues[1].open, false);
    assert.match(state.issues[1].comments.at(-1).body, /Closing this issue/);
    const before = readFileSync(statePath, "utf8");
    for (const mode of ["fail", "success"]) assert.equal(run(mode, "probe FAILED", { EXPECTED_REJECTION: "true" }).status, 0);
    const local = workflow.jobs["report-failure"].steps.find((step: { run?: string }) => step.run?.includes("site-deploy-failed"));
    const skipped = spawnSync("bash", ["-c", local.run], { env: { ...env, EXPECTED_REJECTION: "true" }, encoding: "utf8" });
    assert.equal(skipped.status, 0, skipped.stderr);
    assert.equal(readFileSync(statePath, "utf8"), before);
    assert.match(run("fail", "expected_rejection=true").stdout, /created/);
    assert.equal(run("success", "").status, 0);
    const denied = run("fail", "HTTP 503", { FAIL_LABEL: "true" });
    assert.notEqual(denied.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("failure capture propagates actual failing signatures without passing gate contamination", () => {
  const dir = mkdtempSync(join(tmpdir(), "site-step-"));
  try {
    for (const [text, expected] of [["producing run concluded null", "producer-not-concluded"], ["Explorer read-model version 16 expected, got 17", "contract-version-mismatch"], ["fail snapshot_digest: changed", "snapshot-digest"], ["probe FAILED: mismatch", "probe-mismatch"], ["deploy: candidate core_sha has diverged; refusing a diverged bundle (diverged-bundle)", "diverged-bundle"], ["pass snapshot_digest: matched\nfail privacy: unknown", "infrastructure"]]) {
      const output = join(dir, "output");
      writeFileSync(output, "");
      const result = spawnSync(process.execPath, ["--experimental-strip-types", join(root, "deploy/run-step.ts"), process.execPath, "-e", `console.error(${JSON.stringify(text)}); process.exit(7)`], { env: { ...process.env, GITHUB_OUTPUT: output }, encoding: "utf8" });
      assert.equal(result.status, 7, result.stderr);
      assert.equal(readFileSync(output, "utf8"), `failure_class=${expected}\n`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("workflow keeps bridge permissions and scopes while wiring failure outputs and explicit markers", () => {
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(workflow.jobs["report-failure"].permissions, { issues: "write" });
  assert.equal(workflow.jobs["report-success"].permissions, undefined);
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.expected_rejection, { description: "Expected-failure probe: do not open, comment on or close incidents", type: "boolean", required: false, default: false });
  for (const name of ["report-failure", "report-success"]) {
    const steps = workflow.jobs[name].steps;
    const reporter = steps.findIndex((step: { run?: string }) => step.run?.includes("relay-cli.ts"));
    assert.ok(steps.slice(0, reporter).some((step: { uses?: string }) => step.uses?.startsWith("actions/checkout@")));
    assert.ok(steps.slice(0, reporter).some((step: { uses?: string }) => step.uses?.startsWith("actions/setup-node@")));
    const app = steps.find((step: { id?: string }) => step.id === "app");
    assert.equal(app.with.owner, "BenchBox-dev");
    assert.equal(app.with.repositories, "BenchBox");
    assert.deepEqual(Object.keys(app.with).sort(), ["app-id", "owner", "private-key", "repositories"]);
    assert.match(steps[reporter].env.EXPECTED_REJECTION, /inputs.expected_rejection.*client_payload.expected_rejection/);
  }
  assert.match(workflow.jobs["report-failure"].steps.at(-1).env.ERROR_TEXT, /needs.build.outputs.failure_class.*needs.deploy.outputs.failure_class/);
  assert.match(workflow.jobs.build.outputs.failure_class, /steps.resolve.outputs.failure_class.*steps.build.outputs.failure_class.*steps.gates.outputs.failure_class/);
  assert.match(workflow.jobs.deploy.outputs.failure_class, /steps.probe.outputs.probes_ok == 'false'/);
});

test("a superseded resolve skips the build steps, the artifact uploads, the stop summary and the deploy job", () => {
  const gated = "steps.resolve.outputs.superseded != 'true'";
  assert.equal(workflow.jobs.build.outputs.superseded, "${{ steps.resolve.outputs.superseded }}");
  const steps = workflow.jobs.build.steps;
  const afterResolve = steps.slice(steps.findIndex((step: { id?: string }) => step.id === "resolve") + 1);
  for (const step of afterResolve) {
    if (step.name === "Restore the receipt's artifact") continue;
    assert.ok(String(step.if ?? "").includes(gated), `${step.name ?? step.uses} runs when the bundle is superseded`);
  }
  assert.equal(afterResolve.filter((step: { uses?: string }) => step.uses?.startsWith("actions/upload-artifact@")).length, 2);
  assert.match(workflow.jobs.deploy.if, /needs.build.outputs.superseded != 'true'/);
  assert.match(workflow.jobs.deploy.if, /^\(vars.SITE_DEPLOY_TARGET == 'rehearsal' \|\| vars.SITE_DEPLOY_TARGET == 'production'\) &&/);
});

test("a superseded run neither reports a failure nor closes a core relay issue", () => {
  assert.equal(workflow.jobs["report-failure"].if, "failure()");
  assert.match(workflow.jobs["report-success"].if, /needs.deploy.result == 'success'/);
});
