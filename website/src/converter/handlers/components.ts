import type { RootContent } from "mdast";

export type CalloutType = "note" | "tip" | "caution" | "danger";

export function calloutNode(type: CalloutType, title: string, children: RootContent[]): RootContent {
  return {
    type: "mdxJsxFlowElement",
    name: "Callout",
    attributes: [
      { type: "mdxJsxAttribute", name: "type", value: type },
      { type: "mdxJsxAttribute", name: "title", value: title },
    ],
    children,
  } as unknown as RootContent;
}

export function mermaidNode(diagram: string): RootContent {
  return {
    type: "mdxJsxFlowElement",
    name: "Mermaid",
    attributes: [
      {
        type: "mdxJsxAttribute",
        name: "diagram",
        value: { type: "mdxJsxAttributeValueExpression", value: JSON.stringify(diagram) },
      },
    ],
    children: [],
  } as unknown as RootContent;
}
