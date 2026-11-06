import type { RootContent } from "mdast";
import { ConverterError } from "../errors.ts";
import { EmbedBlockError, parseEmbedBlock } from "../../lib/results-embed.ts";
import type { SyntaxHandler } from "../types.ts";
import { islandNode } from "./components.ts";

export const resultEmbedFenceSyntax: SyntaxHandler<"result-embed-fence"> = {
  kind: "syntax",
  name: "result-embed-fence",
  handle(node, at, context): RootContent[] {
    try {
      const block = parseEmbedBlock(node.value);
      if (block.kind === "cited") {
        context.useComponent("CitedResult");
        return [islandNode("CitedResult", "citation", block.citation)];
      }
      context.useComponent("CurrentResults");
      return [islandNode("CurrentResults", "results", block.results)];
    } catch (error) {
      if (error instanceof EmbedBlockError) throw new ConverterError(at.file, at.line, error.message);
      throw error;
    }
  },
};
