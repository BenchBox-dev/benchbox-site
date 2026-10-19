export const RELAY_LABEL = "site-bundle-undeployed";
export const RELAY_TITLE = "Site could not deploy a core bundle";
export const FAILURE_CLASSES = [
  "producer-not-concluded",
  "contract-version-mismatch",
  "snapshot-digest",
  "probe-mismatch",
  "infrastructure",
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

export function classifyFailure(errorText: string): FailureClass {
  const text = (errorText || "").toLowerCase();
  if (
    text.includes("producing run concluded null") ||
    text.includes("wait cap") ||
    text.includes("producing run is") ||
    text.includes("producer-not-concluded")
  ) {
    return "producer-not-concluded";
  }
  if (
    text.includes("explorer read-model version") ||
    text.includes("contract version") ||
    text.includes("contract-version") ||
    text.includes("contract_version")
  ) {
    return "contract-version-mismatch";
  }
  if (text.includes("snapshot_digest") || text.includes("snapshot digest") || text.includes("snapshot-digest")) {
    return "snapshot-digest";
  }
  if (
    text.includes("probe failed") ||
    text.includes("probes failed") ||
    text.includes("probe mismatch") ||
    text.includes("probe-mismatch")
  ) {
    return "probe-mismatch";
  }
  return "infrastructure";
}

export function extractFailureClass(body: string | null | undefined): FailureClass | null {
  const match = (body || "").match(/<!--\s*failure-class:\s*([a-z-]+)\s*-->/);
  if (match && (FAILURE_CLASSES as readonly string[]).includes(match[1])) {
    return match[1] as FailureClass;
  }
  return null;
}

export function failureMessage(
  failureClass: FailureClass,
  details: { coreSha?: string; runUrl?: string; rawError?: string } = {},
): string {
  const sha = details.coreSha || "unknown";
  const url = details.runUrl || "unknown";
  const marker = `<!-- failure-class: ${failureClass} -->`;
  let extra = "";
  if (failureClass === "contract-version-mismatch") {
    extra = "\n\nRequired action: update the Explorer for the new contract.";
  }
  return `${marker}\nThe site could not deploy the bundle for core commit ${sha} (class: ${failureClass}).\n\nSite run: ${url}${extra}\n`;
}

export type GhClient = {
  listOpenIssues: (repo: string, label: string) => Promise<{ number: number; body?: string }[]>;
  issueBodies: (repo: string, issueNumber: number) => Promise<string[]>;
  createIssue: (repo: string, title: string, label: string, body: string) => Promise<{ number: number }>;
  commentIssue: (repo: string, issueNumber: number, body: string) => Promise<void>;
  closeIssue: (repo: string, issueNumber: number, comment: string) => Promise<void>;
  createLabelIfMissing: (repo: string, label: string, color: string, description: string) => Promise<void>;
};

export async function reportRelayFailure(
  client: GhClient,
  coreRepo: string,
  errorText: string,
  details: {
    coreSha?: string;
    runUrl?: string;
    expectedRejection?: boolean;
  } = {},
): Promise<{ action: "skipped" | "created" | "commented" | "no_change"; issueNumber?: number; failureClass?: FailureClass }> {
  if (details.expectedRejection) {
    return { action: "skipped" };
  }

  const failureClass = classifyFailure(errorText);
  const body = failureMessage(failureClass, details);

  const openIssues = await client.listOpenIssues(coreRepo, RELAY_LABEL);
  if (openIssues.length === 0) {
    await client.createLabelIfMissing(coreRepo, RELAY_LABEL, "B60205", "A core bundle could not be deployed by the site");
    const created = await client.createIssue(coreRepo, RELAY_TITLE, RELAY_LABEL, body);
    return { action: "created", issueNumber: created.number, failureClass };
  }

  const existing = openIssues[0];
  const bodies = await client.issueBodies(coreRepo, existing.number);
  const existingClass = bodies.reverse().map(extractFailureClass).find((value) => value !== null);

  if (existingClass === failureClass) {
    return { action: "no_change", issueNumber: existing.number, failureClass };
  }

  await client.commentIssue(coreRepo, existing.number, body);
  return { action: "commented", issueNumber: existing.number, failureClass };
}

export async function closeRelayOnSuccess(
  client: GhClient,
  coreRepo: string,
  details: {
    coreSha?: string;
    runUrl?: string;
    expectedRejection?: boolean;
  } = {},
): Promise<{ action: "skipped" | "closed" | "none_open"; issueNumber?: number }> {
  if (details.expectedRejection) {
    return { action: "skipped" };
  }

  const openIssues = await client.listOpenIssues(coreRepo, RELAY_LABEL);
  if (openIssues.length === 0) {
    return { action: "none_open" };
  }

  const sha = details.coreSha || "unknown";
  const url = details.runUrl || "unknown";
  const comment = `A site deploy succeeded for core commit ${sha}.\n\nSite run: ${url}\n\nClosing this issue.`;

  for (const issue of openIssues) {
    await client.closeIssue(coreRepo, issue.number, comment);
  }

  return { action: "closed", issueNumber: openIssues[0].number };
}
