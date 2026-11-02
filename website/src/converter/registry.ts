import { UnknownConstructError } from "./errors.ts";
import type { SourcePosition } from "./model.ts";
import type { FrontMatterHandler, Handler, SyntaxHandler, SyntaxName } from "./types.ts";

type SyntaxTable = { [N in SyntaxName]?: SyntaxHandler<N> };

type LooseSyntaxTable = Partial<Record<SyntaxName, SyntaxHandler>>;

export class HandlerRegistry {
  private readonly frontMatter = new Map<string, FrontMatterHandler>();
  private readonly syntax: SyntaxTable = {};

  register(handler: Handler): this {
    if (handler.kind === "front-matter") for (const key of handler.keys) this.frontMatter.set(key, handler);
    else this.setSyntax(handler);
    return this;
  }

  private setSyntax(handler: SyntaxHandler): void {
    (this.syntax as LooseSyntaxTable)[handler.name] = handler;
  }

  frontMatterKey(key: string, at: SourcePosition): FrontMatterHandler {
    const handler = this.frontMatter.get(key);
    if (!handler) throw new UnknownConstructError(at.file, at.line, `front-matter:${key}`);
    return handler;
  }

  syntaxHandler<N extends SyntaxName>(name: N, at: SourcePosition): SyntaxHandler<N> {
    const handler = this.syntax[name];
    if (!handler) throw new UnknownConstructError(at.file, at.line, `syntax:${name}`);
    return handler;
  }
}
