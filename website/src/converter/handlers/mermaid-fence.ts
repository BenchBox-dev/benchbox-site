import type { RootContent } from "mdast";
import { UnknownConstructError } from "../errors.ts";
import type { SyntaxHandler } from "../types.ts";
import { mermaidNode } from "./components.ts";

export const mermaidFenceSyntax: SyntaxHandler<"mermaid-fence"> = {
  kind: "syntax",
  name: "mermaid-fence",
  handle(node, at, context): RootContent[] {
    const diagram = node.value.trim();
    if (diagram === "") throw new UnknownConstructError(at.file, at.line, "mermaid-fence", "a mermaid code fence needs a diagram body");
    context.useComponent("Mermaid");
    return [mermaidNode(diagram)];
  },
};
