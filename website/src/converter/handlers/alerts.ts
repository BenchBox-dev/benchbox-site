import type { Blockquote, RootContent } from "mdast";
import { calloutNode, type CalloutType } from "./components.ts";
import type { SyntaxHandler } from "../types.ts";

export type AlertKind = "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION";

const ALERTS: Readonly<Record<AlertKind, { type: CalloutType; title: string }>> = {
  NOTE: { type: "note", title: "Note" },
  TIP: { type: "tip", title: "Tip" },
  IMPORTANT: { type: "caution", title: "Important" },
  WARNING: { type: "caution", title: "Warning" },
  CAUTION: { type: "danger", title: "Caution" },
};

const MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/;

export type AlertBlock = { kind: AlertKind; children: RootContent[] };

export function splitAlert(node: Blockquote): AlertBlock | undefined {
  const [first, ...rest] = node.children;
  if (first?.type !== "paragraph") return undefined;
  const [lead, ...inline] = first.children;
  if (lead?.type !== "text") return undefined;
  const marker = MARKER.exec(lead.value);
  if (!marker) return undefined;
  const remainder = lead.value.slice(marker[0].length);
  const children = [...(remainder === "" ? [] : [{ ...lead, value: remainder }]), ...inline];
  return { kind: marker[1] as AlertKind, children: children.length === 0 ? rest : [{ ...first, children }, ...rest] };
}

export const alertSyntax: SyntaxHandler<"alert"> = {
  kind: "syntax",
  name: "alert",
  handle(alert, _at, context) {
    context.useComponent("Callout");
    const { type, title } = ALERTS[alert.kind];
    return [calloutNode(type, title, alert.children)];
  },
};
