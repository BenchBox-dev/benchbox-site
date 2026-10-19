import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyFailure,
  extractFailureClass,
  failureMessage,
  reportRelayFailure,
  closeRelayOnSuccess,
  RELAY_LABEL,
  FORBIDDEN_LABEL,
  type GhClient,
} from "../lib/relay.ts";

function fakeGhClient(initialIssues: { number: number; body?: string }[] = []): GhClient & {
  created: { repo: string; title: string; label: string; body: string }[];
  commented: { repo: string; issueNumber: number; body: string }[];
  closed: { repo: string; issueNumber: number; comment: string }[];
  labelsCreated: string[];
} {
  const issues = [...initialIssues];
  const created: { repo: string; title: string; label: string; body: string }[] = [];
  const commented: { repo: string; issueNumber: number; body: string }[] = [];
  const closed: { repo: string; issueNumber: number; comment: string }[] = [];
  const labelsCreated: string[] = [];

  return {
    created,
    commented,
    closed,
    labelsCreated,
    async listOpenIssues(_repo: string, label: string) {
      if (label !== RELAY_LABEL) return [];
      return [...issues];
    },
    async createIssue(repo: string, title: string, label: string, body: string) {
      const number = issues.length + 100;
      issues.push({ number, body });
      created.push({ repo, title, label, body });
      return { number };
    },
    async commentIssue(repo: string, issueNumber: number, body: string) {
      commented.push({ repo, issueNumber, body });
      const found = issues.find((item) => item.number === issueNumber);
      if (found) found.body = body;
    },
    async closeIssue(repo: string, issueNumber: number, comment: string) {
      closed.push({ repo, issueNumber, comment });
      const index = issues.findIndex((item) => item.number === issueNumber);
      if (index >= 0) issues.splice(index, 1);
    },
    async createLabelIfMissing(_repo: string, label: string) {
      labelsCreated.push(label);
    },
  };
}

test("classifyFailure maps known signatures to their failure classes", () => {
  assert.equal(classifyFailure("bundle:fetch: producing run concluded null"), "producer-not-concluded");
  assert.equal(classifyFailure("producing run 123 did not complete within the 10-minute wait cap"), "producer-not-concluded");
  assert.equal(classifyFailure("Explorer read-model version 16 expected, got 17"), "contract-version-mismatch");
  assert.equal(classifyFailure("contract-version mismatch: schema version too new"), "contract-version-mismatch");
  assert.equal(classifyFailure("fail snapshot_digest: corpus is unchanged but the snapshot contents changed"), "snapshot-digest");
  assert.equal(classifyFailure("probe FAILED: 32 matched, 1 mismatched"), "probe-mismatch");
  assert.equal(classifyFailure("probes failed after deploy; see the receipt"), "probe-mismatch");
  assert.equal(classifyFailure("HTTP 503: 503 Egress is over the account limit"), "infrastructure");
  assert.equal(classifyFailure("unexpected token at position 42"), "infrastructure");
  assert.equal(classifyFailure(""), "infrastructure");
});

test("contract-version-mismatch failure message states the required action", () => {
  const msg = failureMessage("contract-version-mismatch", { coreSha: "abc1234", runUrl: "https://example.com/run" });
  assert.ok(msg.includes("update the Explorer for the new contract"));
  assert.ok(msg.includes("<!-- failure-class: contract-version-mismatch -->"));
  assert.equal(extractFailureClass(msg), "contract-version-mismatch");
});

test("reportRelayFailure creates an issue when none is open", async () => {
  const client = fakeGhClient();
  const outcome = await reportRelayFailure(client, "BenchBox-dev/BenchBox", "Explorer read-model version 16 expected, got 17", {
    coreSha: "core123",
    runUrl: "https://run.url",
  });
  assert.equal(outcome.action, "created");
  assert.equal(client.created.length, 1);
  assert.equal(client.created[0].label, RELAY_LABEL);
  assert.notEqual(client.created[0].label, FORBIDDEN_LABEL);
  assert.ok(client.created[0].body.includes("contract-version-mismatch"));
});

test("reportRelayFailure skips comment when existing issue has the same class", async () => {
  const existingBody = failureMessage("snapshot-digest", { coreSha: "core123" });
  const client = fakeGhClient([{ number: 50, body: existingBody }]);
  const outcome = await reportRelayFailure(client, "BenchBox-dev/BenchBox", "snapshot_digest: corpus unchanged but contents changed", {
    coreSha: "core456",
  });
  assert.equal(outcome.action, "no_change");
  assert.equal(client.commented.length, 0);
  assert.equal(client.created.length, 0);
});

test("reportRelayFailure comments when failure class changes", async () => {
  const existingBody = failureMessage("producer-not-concluded", { coreSha: "core123" });
  const client = fakeGhClient([{ number: 50, body: existingBody }]);
  const outcome = await reportRelayFailure(client, "BenchBox-dev/BenchBox", "probe FAILED: 31 matched, 2 mismatched", {
    coreSha: "core456",
  });
  assert.equal(outcome.action, "commented");
  assert.equal(client.commented.length, 1);
  assert.equal(client.commented[0].issueNumber, 50);
  assert.ok(client.commented[0].body.includes("probe-mismatch"));
});

test("reportRelayFailure skips expected rejections", async () => {
  const client = fakeGhClient();
  const outcome = await reportRelayFailure(client, "BenchBox-dev/BenchBox", "producing run concluded null", {
    coreSha: "core123",
    expectedRejection: true,
  });
  assert.equal(outcome.action, "skipped");
  assert.equal(client.created.length, 0);
  assert.equal(client.commented.length, 0);
});

test("closeRelayOnSuccess closes open relay issue", async () => {
  const existingBody = failureMessage("snapshot-digest", { coreSha: "core123" });
  const client = fakeGhClient([{ number: 75, body: existingBody }]);
  const outcome = await closeRelayOnSuccess(client, "BenchBox-dev/BenchBox", {
    coreSha: "core456",
    runUrl: "https://success.url",
  });
  assert.equal(outcome.action, "closed");
  assert.equal(client.closed.length, 1);
  assert.equal(client.closed[0].issueNumber, 75);
  assert.ok(client.closed[0].comment.includes("Closing this issue"));
});

test("closeRelayOnSuccess skips when expected rejection", async () => {
  const client = fakeGhClient([{ number: 75, body: "test" }]);
  const outcome = await closeRelayOnSuccess(client, "BenchBox-dev/BenchBox", {
    expectedRejection: true,
  });
  assert.equal(outcome.action, "skipped");
  assert.equal(client.closed.length, 0);
});

test("relay never uses forbidden site-bundle-failed label", async () => {
  assert.equal(RELAY_LABEL, "site-bundle-undeployed");
  assert.notEqual(RELAY_LABEL, FORBIDDEN_LABEL);

  const client = fakeGhClient();
  await reportRelayFailure(client, "BenchBox-dev/BenchBox", "egress 503");
  assert.equal(client.created[0].label, "site-bundle-undeployed");
  assert.ok(!client.labelsCreated.includes(FORBIDDEN_LABEL));
});
