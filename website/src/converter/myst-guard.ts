import { UnknownConstructError } from "./errors.ts";
import type { SourcePosition } from "./model.ts";

const DIRECTIVE_FENCE = /^\{[\w:-]+\}/;
const ROLE_BEFORE_CODE = /\{[\w:.+-]+\}$/;
const LABEL_LINE = /^\([^)\s]+\)=\s*$/;

const GUIDANCE = "pages are plain GitHub-flavoured Markdown; MyST syntax is not supported";

export function rejectDirectiveFence(lang: string | null | undefined, at: SourcePosition): void {
  if (lang && DIRECTIVE_FENCE.test(lang)) throw new UnknownConstructError(at.file, at.line, "myst-directive", `code fence ${lang} is a MyST directive: ${GUIDANCE}`);
}

export function rejectRoleBeforeCode(text: string, at: SourcePosition): void {
  const role = ROLE_BEFORE_CODE.exec(text);
  if (role) throw new UnknownConstructError(at.file, at.line + text.slice(0, role.index).split("\n").length - 1, "myst-role", `${role[0]} before an inline code span is a MyST role: ${GUIDANCE}`);
}

export function rejectLabelLines(text: string, at: SourcePosition): void {
  const lines = text.split("\n");
  const found = lines.findIndex((line) => LABEL_LINE.test(line));
  if (found >= 0) throw new UnknownConstructError(at.file, at.line + found, "myst-label", `${lines[found].trim()} is a MyST label: ${GUIDANCE}`);
}
