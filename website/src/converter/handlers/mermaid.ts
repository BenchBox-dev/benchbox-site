import { UnknownConstructError } from "../errors.ts";
import type { DirectiveHandler } from "../types.ts";
import { mermaidNode } from "./components.ts";

export const mermaidDirective: DirectiveHandler = {
  kind: "directive",
  names: ["mermaid"],
  options: [],
  argument: "none",
  handle(call, context) {
    const diagram = call.body.trim();
    if (diagram === "") {
      throw new UnknownConstructError(call.at.file, call.at.line, "directive-body:mermaid", "mermaid requires a diagram body");
    }
    context.useComponent("Mermaid");
    return [mermaidNode(diagram)];
  },
};
