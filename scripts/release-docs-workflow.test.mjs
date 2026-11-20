import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const workflow = parse(readFileSync(new URL("../.github/workflows/release-docs.yml", import.meta.url), "utf8"));
const pin = workflow.jobs["pin-pull-request"];
const release = workflow.jobs["release-pull-request"];
const scripts = (job) => job.steps.filter((step) => step.run).map((step) => step.run);
const allScripts = [...scripts(pin), ...scripts(release)].join("\n");
const commands = allScripts.replace(/<<EOF[\s\S]*?\n\s*EOF/g, "").split("\n").filter((line) => !/^\s*BODY=/.test(line)).join("\n");
const mint = (job) => job.steps.filter((step) => (step.uses ?? "").startsWith("actions/create-github-app-token@"));

test("triggers are the hourly schedule, dispatch, the core-release dispatch and pushes to next", () => {
  assert.deepEqual(Object.keys(workflow.on).sort(), ["push", "repository_dispatch", "schedule", "workflow_dispatch"]);
  assert.equal(workflow.on.schedule.length, 1);
  assert.match(workflow.on.schedule[0].cron, /^\d+ \* \* \* \*$/);
  assert.deepEqual(workflow.on.repository_dispatch.types, ["core-release"]);
  assert.deepEqual(workflow.on.push.branches, ["next"]);
});

test("each stage runs only on its own triggers", () => {
  assert.equal(pin.if, "github.event_name != 'push'");
  assert.equal(release.if, "github.event_name == 'push'");
});

test("permissions are read-only by default and per job as narrow as the job allows", () => {
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(pin.permissions, { contents: "read", issues: "write", "pull-requests": "read" });
  assert.deepEqual(release.permissions, { contents: "read", "pull-requests": "read" });
});

test("each stage is serialised in its own concurrency group that never cancels", () => {
  assert.equal(workflow.concurrency.group, "release-docs-${{ github.event_name == 'push' && 'release' || 'pin' }}");
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
});

test("checkouts keep no credentials", () => {
  for (const job of [pin, release]) {
    const checkout = job.steps.find((step) => (step.uses ?? "").startsWith("actions/checkout@"));
    assert.equal(checkout.with.ref, "next");
    assert.equal(checkout.with["persist-credentials"], false);
  }
});

test("app tokens are minted for named repositories with the permissions the steps need", () => {
  const [core, site] = mint(pin);
  assert.equal(core.with.repositories, "BenchBox");
  assert.equal(core.with["permission-actions"], "read");
  assert.equal(site.with.repositories, "benchbox-site");
  assert.equal(site.with["permission-contents"], "write");
  assert.equal(site.with["permission-pull-requests"], "write");
  const [releaseSite] = mint(release);
  assert.equal(releaseSite.with.repositories, "benchbox-site");
  assert.equal(releaseSite.with["permission-pull-requests"], "write");
  assert.equal(releaseSite.with["permission-contents"], undefined);
});

test("an app token reaches only the steps that need it", () => {
  const holders = (job) => job.steps.filter((step) => JSON.stringify(step.env ?? {}).includes("steps.core.outputs.token") || JSON.stringify(step.env ?? {}).includes("steps.site.outputs.token")).map((step) => step.name);
  assert.deepEqual(holders(pin), ["Pin the release", "Commit the pin and push its branch", "Open the pin pull request"]);
  assert.deepEqual(holders(release), ["Open the release pull request"]);
  const text = JSON.stringify(workflow);
  assert.equal(text.match(/steps\.(core|site)\.outputs\.token/g).length, 4);
});

test("the pin step uses the default docs:pin path", () => {
  const step = pin.steps.find((candidate) => candidate.name === "Pin the release");
  assert.ok(step.run.includes('npm run -s docs:pin -- "$TAG"'));
  assert.ok(!allScripts.includes("--from"));
});

test("a failed pin leaves no branch and reports on the docs-release-pending issue", () => {
  const names = pin.steps.map((step) => step.name);
  const pinned = names.indexOf("Pin the release");
  const commit = names.indexOf("Commit the pin and push its branch");
  assert.ok(pinned < names.indexOf("Report a failed pin on the docs-release-pending issue"));
  assert.ok(names.indexOf("Fail the run when the pin failed") < commit);
  assert.equal(pin.steps[commit].if, "steps.pin.outputs.pinned == 'true'");
  const report = pin.steps.find((step) => step.name?.startsWith("Report a failed pin"));
  assert.equal(report.if, "steps.pin.outputs.pinned == 'false'");
  assert.ok(report.run.includes("--label docs-release-pending"));
  assert.ok(report.run.includes("gh issue comment"));
  assert.ok(pin.steps[commit].run.indexOf("git switch -c") < pin.steps[commit].run.indexOf("git push"));
});

test("the pending exit codes decide what happens: 2 fails, 1 pins, 0 does nothing", () => {
  const step = pin.steps.find((candidate) => candidate.id === "pending");
  assert.ok(step.run.includes("docs:pin -- --pending"));
  assert.ok(step.run.includes('[ "$code" -eq 1 ]'));
  assert.ok(step.run.includes('exit "$code"'));
  const existing = pin.steps.find((candidate) => candidate.id === "existing");
  assert.equal(existing.if, "steps.pending.outputs.code == '1'");
  for (const id of ["core", "pin"]) assert.equal(pin.steps.find((candidate) => candidate.id === id).if, "steps.existing.outputs.action == 'pin'");
});

test("a pull request in any state skips the tag and a branch without one gets a pull request", () => {
  const existing = pin.steps.find((candidate) => candidate.id === "existing");
  assert.ok(existing.run.includes('git/ref/heads/release-pin/$TAG'));
  assert.ok(existing.run.includes('--head "release-pin/$TAG" --state all'));
  assert.ok(existing.run.includes('echo "action=none"'));
  assert.ok(existing.run.includes('echo "action=open"'));
  const open = pin.steps.find((step) => step.name === "Open the pin pull request");
  assert.equal(open.if, "steps.existing.outputs.action == 'open' || steps.pin.outputs.pinned == 'true'");
  const site = pin.steps.find((step) => step.id === "site");
  assert.equal(site.if, open.if);
});

test("the failure comment is deduplicated on the final docs:pin error line only", () => {
  const report = pin.steps.find((step) => step.name?.startsWith("Report a failed pin"));
  assert.ok(report.run.includes("grep '^docs:pin:'"));
  assert.ok(report.run.includes("printf '%s' \"$ERROR_LINE\" | sha256sum"));
  assert.ok(!report.run.includes('sha256sum "$RUNNER_TEMP/pin.txt"'));
});

test("the pin commit is authored by the app bot and stages explicit paths", () => {
  const run = pin.steps.find((step) => step.name?.startsWith("Commit the pin")).run;
  assert.ok(run.includes('GIT_AUTHOR_NAME="$BOT"'));
  assert.ok(run.includes("users.noreply.github.com"));
  assert.ok(run.includes("git add --all -- release-pin"));
  assert.ok(!/git add (-A|\.)(\s|$)/.test(run));
  assert.ok(!/Joe Harris|joeharris76|Co-authored-by/i.test(run));
});

test("the pull request into next is titled for the tag and says what merging does", () => {
  const run = pin.steps.find((step) => step.name === "Open the pin pull request").run;
  assert.ok(run.includes('--base next --head "$BRANCH" --title "Pin the documentation to core $TAG"'));
  assert.ok(run.includes("opens the `next` into `main` release pull request"));
});

test("stage 2 acts only when next's pin tag is above main's and no pull request is open", () => {
  const compare = release.steps.find((step) => step.id === "pins");
  assert.ok(compare.run.includes("git show origin/next:release-pin/pin.json"));
  assert.ok(compare.run.includes("git show origin/main:release-pin/pin.json"));
  assert.ok(compare.run.includes("sort -V"));
  assert.ok(compare.run.includes('--base main --state all --search "\\"$TITLE\\" in:title"'));
  assert.ok(compare.run.includes('TITLE="Release documentation for $NEXT_TAG"'));
  assert.ok(compare.run.includes("--base main --state open --json number,title,body"));
  for (const name of ["Mint a token for this repository", "Open the release pull request"]) {
    assert.equal(release.steps.find((step) => step.name === name).if, "steps.pins.outputs.release == 'true'");
  }
});

test("the release pull request lists the documentation commits and gives the hold-back steps", () => {
  const run = release.steps.find((step) => step.name === "Open the release pull request").run;
  assert.ok(run.includes("git diff --stat=100 origin/main origin/next -- docs blog"));
  assert.ok(run.includes('git log --no-merges --oneline "$PIN_COMMIT..origin/next" -- docs blog'));
  assert.ok(!run.includes("origin/main..origin/next"));
  assert.ok(!/retarget/i.test(run));
  assert.ok(run.includes('--title "Release documentation for $TAG"'));
  assert.ok(run.includes("which fails only on the facts core exports in \\`doc-contracts.json\\`"));
  assert.ok(!run.includes("fails if any passage is not true at the release"));
  for (const phrase of ["review each documentation change on \\`next\\` since the previous pin", "Branch from \\`next\\`", "restore the text released on \\`main\\`", "Close this pull request and open one from the hold-back branch", "Squash-merge it into \\`main\\`", "Apply to \\`next\\` the corrections that are also true on \\`develop\\`", "gh pr merge --merge"]) {
    assert.ok(run.includes(phrase), phrase);
  }
});

test("no step merges, pushes to main or next, or force-pushes", () => {
  assert.ok(!/gh pr merge|--auto|git merge|git rebase|--force|--force-with-lease| -f |push\s+\S*\s+\+/.test(commands));
  const pushes = allScripts.split("\n").filter((line) => /git push/.test(line));
  assert.equal(pushes.length, 1);
  assert.ok(pushes[0].includes('"HEAD:refs/heads/${BRANCH}"'));
  assert.ok(allScripts.includes('BRANCH="release-pin/$TAG"'));
  assert.ok(!/refs\/heads\/(main|next)"/.test(allScripts.replace(/'\+refs\/heads\/(main|next):refs\/remotes\/origin\/(main|next)'/g, "")));
  assert.ok(!allScripts.includes("gh api -X") && !/--method\s+(PUT|PATCH|DELETE)/.test(allScripts));
});

test("gh api is used only for the two known read calls", () => {
  const calls = commands.split("\n").filter((line) => /gh api\b/.test(line)).map((line) => line.trim().replace(/^.*?(gh api)/, "$1"));
  assert.deepEqual(calls.sort(), ['gh api "repos/$REPO/git/ref/heads/release-pin/$TAG" --jq .ref 2>&1)"; then', 'gh api "users/${BOT}" --jq .id)"'].sort());
});

test("only the known pinned actions are used", () => {
  const uses = [...pin.steps, ...release.steps].filter((step) => step.uses).map((step) => step.uses);
  assert.deepEqual([...new Set(uses)].sort(), [
    "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09",
    "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1",
    "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444",
  ]);
});

test("actions are pinned to the SHAs the other workflows use", () => {
  for (const step of [...pin.steps, ...release.steps]) {
    if (step.uses) assert.match(step.uses, /@[0-9a-f]{40}$/);
  }
});
