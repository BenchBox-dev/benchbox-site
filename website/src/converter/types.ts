import type { TitleNode } from "../lib/smartypants.ts";
import type { AlertBlock } from "./handlers/alerts.ts";
import type { Code, Definition, Heading, Html, Image, ImageReference, Link, Paragraph, RootContent } from "mdast";
import type { DocsIndex } from "./docs-index.ts";
import type { Collection, ResolvedDoc, SourcePosition } from "./model.ts";

export type ComponentName = "Callout" | "Mermaid" | "Embed";

export interface ConvertContext {
  readonly file: string;
  readonly docsRoot: string;
  readonly collection: Collection;
  readonly pass: "collect" | "emit";
  readonly index: DocsIndex;
  resolveDoc(target: string, at: SourcePosition, kind?: string): ResolvedDoc;
  findDoc(target: string): ResolvedDoc | undefined;
  checkFragment(path: string, fragment: string, at: SourcePosition): void;
  knownBroken(target: string): boolean;
  needsTitle(): boolean;
  allocateHeadingId(text: string): string;
  claimTitle(title: TitleNode[], id: string): void;
  recordHeadingId(id: string): void;
  recordRawId(id: string, at: SourcePosition): void;
  addTags(tags: readonly string[]): void;
  setPageData(key: string, value: unknown): void;
  useComponent(name: ComponentName): void;
  recordImage(name: string): void;
}

export type FrontMatterHandler = {
  kind: "front-matter";
  keys: readonly string[];
  handle(key: string, value: unknown, at: SourcePosition, context: ConvertContext): void;
};

export type SyntaxNodes = {
  heading: Heading;
  link: Link | Definition;
  image: Image | ImageReference;
  "html-comment": Html;
  "raw-html": Html;
  "raw-html-inline": Html;
  "colon-fence": Paragraph;
  alert: AlertBlock;
  "mermaid-fence": Code;
};

export type SyntaxName = keyof SyntaxNodes;

export type SyntaxHandler<N extends SyntaxName = SyntaxName> = {
  kind: "syntax";
  name: N;
  handle(node: SyntaxNodes[N], at: SourcePosition, context: ConvertContext): RootContent[];
};

export type Handler = FrontMatterHandler | SyntaxHandler;
