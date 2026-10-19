import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { type GhClient, reportRelayFailure, closeRelayOnSuccess } from "./lib/relay.ts";

export function execGhClient(env: Record<string, string | undefined> = process.env): GhClient {
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  const execGh = (args: string[]): string => {
    return execFileSync("gh", args, {
      encoding: "utf8",
      env: { ...process.env, ...(token ? { GH_TOKEN: token } : {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
  };

  return {
    async listOpenIssues(repo: string, label: string) {
      const output = execGh(["issue", "list", "--repo", repo, "--label", label, "--state", "open", "--json", "number,body"]);
      return JSON.parse(output || "[]") as { number: number; body?: string }[];
    },
    async issueBodies(repo: string, issueNumber: number) {
      const output = execGh(["issue", "view", String(issueNumber), "--repo", repo, "--json", "body,comments"]);
      const issue = JSON.parse(output) as { body: string; comments: { body: string }[] };
      return [issue.body, ...issue.comments.map((comment) => comment.body)];
    },
    async createIssue(repo: string, title: string, label: string, body: string) {
      const output = execGh(["issue", "create", "--repo", repo, "--title", title, "--label", label, "--body", body]);
      const match = output.match(/\/issues\/(\d+)/);
      const number = match ? Number(match[1]) : 0;
      return { number };
    },
    async commentIssue(repo: string, issueNumber: number, body: string) {
      execGh(["issue", "comment", String(issueNumber), "--repo", repo, "--body", body]);
    },
    async closeIssue(repo: string, issueNumber: number, comment: string) {
      execGh(["issue", "close", String(issueNumber), "--repo", repo, "--comment", comment]);
    },
    async createLabelIfMissing(repo: string, label: string, color: string, description: string) {
      execGh(["label", "create", label, "--repo", repo, "--color", color, "--description", description, "--force"]);
    },
  };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const mode = argv[0];
  const coreRepo = process.env.CORE_REPO || "BenchBox-dev/BenchBox";
  const coreSha = process.env.CORE_SHA || "";
  const runUrl = process.env.RUN_URL || "";
  const expectedRejection = process.env.EXPECTED_REJECTION === "true";
  const errorText = process.env.ERROR_TEXT || "";

  const client = execGhClient();

  if (mode === "fail") {
    const outcome = await reportRelayFailure(client, coreRepo, errorText, {
      coreSha,
      runUrl,
      expectedRejection,
    });
    console.log(`relay failure outcome: ${outcome.action}${outcome.issueNumber ? ` #${outcome.issueNumber}` : ""}`);
    return 0;
  }

  if (mode === "success") {
    const outcome = await closeRelayOnSuccess(client, coreRepo, {
      coreSha,
      runUrl,
      expectedRejection,
    });
    console.log(`relay success outcome: ${outcome.action}${outcome.issueNumber ? ` #${outcome.issueNumber}` : ""}`);
    return 0;
  }

  console.error(`unknown relay mode: ${mode}`);
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
