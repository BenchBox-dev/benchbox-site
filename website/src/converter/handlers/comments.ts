import type { SyntaxHandler } from "../types.ts";

export const htmlCommentSyntax: SyntaxHandler<"html-comment"> = {
  kind: "syntax",
  name: "html-comment",
  handle() {
    return [];
  },
};
