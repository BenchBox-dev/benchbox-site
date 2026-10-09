import { readFileSync } from "node:fs";
import path from "node:path";
import { filesUnder } from "./files.ts";
import { fail, pass, type GateResult } from "./types.ts";

const PATTERNS: { description: string; pattern: RegExp }[] = [
  { description: "GitHub Personal Access Token", pattern: /ghp_[0-9a-zA-Z]{36}/g },
  { description: "GitHub Fine-grained Personal Access Token", pattern: /github_pat_[0-9a-zA-Z_]{82}/g },
  { description: "Private Key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { description: "AWS Access Key ID", pattern: /AKIA[0-9A-Z]{16}/g },
];
const AWS_EXAMPLES = new Set(["AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"]);
const CONNECTION = /(?:postgresql|postgres|mysql):\/\/([^\s/:@]+):([^\s/@]+)@([^\s/@]+)/g;
const PLACEHOLDER_PASSWORDS = new Set(["password", "pass", "your-password", "your_password", "changeme", "***", "<password>"]);
const SCANNED = /\.(html?|json|js|css|svg|txt|xml|csv|ya?ml)$/i;

export function privacyFindings(name: string, text: string): string[] {
  const findings: string[] = [];
  for (const { description, pattern } of PATTERNS) {
    const matches = [...text.matchAll(pattern)].map((match) => match[0]).filter((match) => !AWS_EXAMPLES.has(match));
    if (matches.length > 0) findings.push(`Detected ${description} in '${name}' (${matches.length} occurrence(s))`);
  }
  const credentials = [...text.matchAll(CONNECTION)].filter((match) => !PLACEHOLDER_PASSWORDS.has(match[2].trim().toLowerCase()));
  if (credentials.length > 0) {
    findings.push(`Detected Database connection string with credentials in '${name}' (${credentials.length} occurrence(s))`);
  }
  return findings;
}

export function privacyGate(siteDir: string): GateResult {
  const findings: string[] = [];
  for (const file of filesUnder(siteDir).filter((name) => SCANNED.test(name))) {
    for (const finding of privacyFindings(path.basename(file), readFileSync(path.join(siteDir, file), "utf8"))) {
      findings.push(`${file}: ${finding}`);
    }
  }
  return findings.length === 0 ? pass("no secrets or credentials in the artifact") : fail(`${findings.length} privacy findings`, findings);
}
