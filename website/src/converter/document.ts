import { splitAlert, type AlertBlock } from "./handlers/alerts.ts";
import { lineStarts } from "./handlers/colon-fence.ts";
import type { Code, FootnoteDefinition, Html, Paragraph, PhrasingContent, Root, RootContent } from "mdast";
import { collectionOf, contentIdFor, DocsIndex, routeFor } from "./docs-index.ts";
import { ConverterError, UnknownConstructError, UnresolvedReferenceError } from "./errors.ts";
import { smartenTitle, titleText, type TitleNode } from "../lib/smartypants.ts";
import { EMBED_FENCE } from "../lib/results-embed.ts";
import { IdAllocator } from "./ids.ts";
import type { Collection, DocInfo, PageData, ResolvedDoc, SourcePosition } from "./model.ts";
import { rejectDirectiveFence, rejectLabelLines, rejectRoleBeforeCode } from "./myst-guard.ts";
import { parseFrontMatter, parseMarkdown, type FrontMatter } from "./parse.ts";
import type { HandlerRegistry } from "./registry.ts";
import type { ComponentName, ConvertContext } from "./types.ts";

export type ConvertedDocument = {
  path: string;
  contentId: string;
  collection: Collection;
  data: PageData;
  root: Root;
  info: DocInfo;
  positions: WeakMap<RootContent, SourcePosition>;
  components: ReadonlySet<ComponentName>;
  errors: readonly ConverterError[];
};

export type ConvertRequest = {
  path: string;
  raw: string;
  index: DocsIndex;
  registry: HandlerRegistry;
  docsRoot: string;
  pass: "collect" | "emit";
  knownBroken: ReadonlySet<string>;
};

type PendingFootnote = { label: string; node: Html };

const BLOG_INDEX = "blog/index.md";
const PHRASING_PARENTS = new Set(["paragraph", "heading", "emphasis", "strong", "delete", "link", "linkReference", "tableCell"]);
const BLOCK_PARENTS = new Set(["blockquote", "list", "listItem", "footnoteDefinition", "table", "tableRow"]);
const LEAF_TYPES = new Set(["thematicBreak", "inlineCode", "text", "break", "footnoteReference", "linkReference", "code"]);

class DocumentConverter implements ConvertContext {
  readonly file: string;
  readonly docsRoot: string;
  readonly collection: Collection;
  readonly pass: "collect" | "emit";
  readonly index: DocsIndex;
  private readonly knownBrokenLinks: ReadonlySet<string>;
  readonly errors: ConverterError[] = [];
  readonly components = new Set<ComponentName>();
  private readonly images = new Set<string>();
  readonly pageData = new Map<string, unknown>();
  readonly tags: string[] = [];
  private nesting = 0;
  readonly headingIds: string[] = [];
  title: TitleNode[] | undefined;
  titleId: string | undefined;
  private readonly registry: HandlerRegistry;
  private readonly ids = new IdAllocator();
  private footnotes: PendingFootnote[] = [];
  private readonly rawIds = new Map<string, SourcePosition>();
  readonly positions = new WeakMap<RootContent, SourcePosition>();

  constructor(request: ConvertRequest) {
    this.file = request.path;
    this.docsRoot = request.docsRoot;
    this.collection = collectionOf(request.path);
    this.pass = request.pass;
    this.index = request.index;
    this.registry = request.registry;
    this.knownBrokenLinks = request.knownBroken;
  }

  resolveDoc(target: string, at: SourcePosition, kind = "doc"): ResolvedDoc {
    try {
      return this.index.resolveDoc(this.file, target, at, kind);
    } catch (error) {
      if (this.pass === "collect" && error instanceof UnresolvedReferenceError) return { path: target, route: "#", title: target, titleNodes: [{ type: "text", value: target }] };
      throw error;
    }
  }

  findDoc(target: string): ResolvedDoc | undefined {
    return this.index.findDoc(this.file, target);
  }

  knownBroken(target: string): boolean {
    return this.knownBrokenLinks.has(`${routeFor(this.file)} ${target}`);
  }

  checkFragment(path: string, fragment: string, at: SourcePosition): void {
    if (this.pass === "collect") return;
    const info = this.index.get(path);
    if (!info) throw new UnresolvedReferenceError(at.file, at.line, `link:${path}#${fragment}`, "points at a missing document");
    if (info.ids.includes(fragment) || this.knownBroken(`${info.route}#${fragment}`)) return;
    throw new UnresolvedReferenceError(at.file, at.line, `link:${path}#${fragment}`, `is not an id on ${info.path}`);
  }

  needsTitle(): boolean {
    return this.title === undefined;
  }

  allocateHeadingId(text: string): string {
    return this.ids.fromName(text);
  }

  claimTitle(title: TitleNode[], id: string): void {
    this.title = title;
    this.titleId = id;
  }

  recordRawId(id: string, at: SourcePosition): void {
    if (this.rawIds.has(id)) throw new ConverterError(at.file, at.line, `raw html id ${JSON.stringify(id)} is already used on this page`);
    this.rawIds.set(id, at);
  }

  recordHeadingId(id: string): void {
    this.headingIds.push(id);
  }

  addTags(tags: readonly string[]): void {
    for (const tag of tags) if (!this.tags.includes(tag)) this.tags.push(tag);
  }

  setPageData(key: string, value: unknown): void {
    this.pageData.set(key, value);
  }

  useComponent(name: ComponentName): void {
    this.components.add(name);
  }

  recordImage(name: string): void {
    this.images.add(name);
  }

  private at(node: RootContent | PhrasingContent): SourcePosition {
    return { file: this.file, line: node.position?.start.line ?? 1 };
  }

  private guard(run: () => RootContent[]): RootContent[] {
    try {
      return run();
    } catch (error) {
      if (error instanceof ConverterError) {
        this.errors.push(error);
        return [];
      }
      throw error;
    }
  }

  private blocks(children: RootContent[]): RootContent[] {
    const out: RootContent[] = [];
    const top = this.nesting === 0;
    for (const child of children) {
      const produced = this.guard(() => this.block(child));
      if (top) for (const node of produced) this.positions.set(node, this.at(child));
      out.push(...produced);
    }
    return out;
  }

  private block(node: RootContent): RootContent[] {
    const at = this.at(node);
    switch (node.type) {
      case "html":
        return this.html(node, at);
      case "heading": {
        if (this.nesting > 0) {
          throw new UnknownConstructError(at.file, at.line, "syntax:nested-heading", "a heading inside a blockquote, list or alert is not a section; use bold text or move it out");
        }
        node.children = this.phrasing(node.children);
        return this.registry.syntaxHandler("heading", at).handle(node, at, this);
      }
      case "paragraph":
        return this.paragraph(node, at);
      case "code":
        return this.code(node, at);
      case "definition":
        return this.registry.syntaxHandler("link", at).handle(node, at, this);
      case "yaml":
        return [];
      case "footnoteDefinition":
        return this.footnoteDefinition(node, at);
      case "blockquote": {
        const alert = splitAlert(node);
        return alert ? this.alert(alert, at) : this.container(node, at);
      }
      default:
        return this.container(node, at);
    }
  }

  private alert(alert: AlertBlock, at: SourcePosition): RootContent[] {
    this.nesting += 1;
    try {
      alert.children = this.blocks(alert.children);
    } finally {
      this.nesting -= 1;
    }
    return this.registry.syntaxHandler("alert", at).handle(alert, at, this);
  }

  private footnoteDefinition(node: FootnoteDefinition, at: SourcePosition): RootContent[] {
    const anchor: Html = { type: "html", value: "" };
    this.footnotes.push({ label: node.label ?? node.identifier, node: anchor });
    const [converted] = this.container(node, at) as FootnoteDefinition[];
    const first = converted.children[0];
    if (first?.type === "paragraph") first.children.unshift(anchor);
    else converted.children.unshift(anchor);
    return [converted];
  }

  private releaseFootnotes(): void {
    for (const entry of this.footnotes.splice(0)) {
      const id = this.ids.fromName(entry.label);
      entry.node.value = `<span id="${id}"></span>`;
    }
  }

  private html(node: Html, at: SourcePosition): RootContent[] {
    const name = node.value.startsWith("<!--") ? "html-comment" : "raw-html";
    return this.registry.syntaxHandler(name, at).handle(node, at, this);
  }

  private paragraph(node: Paragraph, at: SourcePosition): RootContent[] {
    const starts = lineStarts(node.children);
    rejectLabelLines(starts.join("\n"), at);
    if (starts.some((line) => line.trimStart().startsWith(":::"))) {
      node.children = this.phrasing(node.children);
      return this.registry.syntaxHandler("colon-fence", at).handle(node, at, this);
    }
    node.children = this.phrasing(node.children);
    return [node];
  }

  private code(node: Code, at: SourcePosition): RootContent[] {
    rejectDirectiveFence(node.lang, at);
    if (node.lang === "mermaid") return this.registry.syntaxHandler("mermaid-fence", at).handle(node, at, this);
    if (node.lang === EMBED_FENCE) return this.registry.syntaxHandler("result-embed-fence", at).handle(node, at, this);
    return [node];
  }

  private container(node: RootContent, at: SourcePosition): RootContent[] {
    if (LEAF_TYPES.has(node.type)) return [node];
    if (node.type === "image" || node.type === "imageReference") return this.registry.syntaxHandler("image", at).handle(node, at, this);
    if (node.type === "thematicBreak") return [node];
    if (BLOCK_PARENTS.has(node.type) && "children" in node) {
      this.nesting += 1;
      try {
        (node as { children: RootContent[] }).children = this.blocks((node as { children: RootContent[] }).children);
      } finally {
        this.nesting -= 1;
      }
      return [node];
    }
    if (PHRASING_PARENTS.has(node.type) && "children" in node) {
      (node as { children: PhrasingContent[] }).children = this.phrasing((node as { children: PhrasingContent[] }).children);
      return [node];
    }
    throw new UnknownConstructError(at.file, at.line, `syntax:mdast-${node.type}`);
  }

  private phrasing(children: PhrasingContent[]): PhrasingContent[] {
    const out: PhrasingContent[] = [];
    children.forEach((child, index) => out.push(...this.phrasingGuard(() => this.phrasingNode(child, children[index + 1]))));
    return out;
  }

  private phrasingGuard(run: () => PhrasingContent[]): PhrasingContent[] {
    try {
      return run();
    } catch (error) {
      if (error instanceof ConverterError) {
        this.errors.push(error);
        return [];
      }
      throw error;
    }
  }

  private phrasingNode(node: PhrasingContent, next: PhrasingContent | undefined): PhrasingContent[] {
    const at = this.at(node);
    switch (node.type) {
      case "text":
        if (next?.type === "inlineCode") rejectRoleBeforeCode(node.value, at);
        if (node.value.includes("$$")) throw new UnknownConstructError(at.file, at.line, "syntax:math", "$$ math is not supported");
        return [node];
      case "inlineCode":
      case "break":
        return [node];
      case "footnoteReference":
        return [{ type: "html", value: `<span id="${this.ids.automatic()}"></span>` }, node];
      case "html": {
        const name = node.value.startsWith("<!--") ? "html-comment" : "raw-html-inline";
        return this.registry.syntaxHandler(name, at).handle(node, at, this) as PhrasingContent[];
      }
      case "image":
      case "imageReference":
        return this.registry.syntaxHandler("image", at).handle(node, at, this) as PhrasingContent[];
      case "link": {
        node.children = this.phrasing(node.children);
        return this.registry.syntaxHandler("link", at).handle(node, at, this) as PhrasingContent[];
      }
      case "emphasis":
      case "strong":
      case "delete":
      case "linkReference":
        node.children = this.phrasing(node.children);
        return [node];
      default:
        throw new UnknownConstructError(at.file, at.line, `syntax:mdast-${(node as { type: string }).type}`);
    }
  }

  convertTree(tree: Root): RootContent[] {
    const body = this.blocks(tree.children);
    this.releaseFootnotes();
    return body;
  }

  assemble(body: RootContent[]): ConvertedDocument {
    const generated = new Set(this.ids.all());
    for (const [id, at] of this.rawIds) {
      if (generated.has(id)) this.errors.push(new ConverterError(at.file, at.line, `raw html id ${JSON.stringify(id)} duplicates an id the page already generates`));
    }
    const frontTitle = this.pageData.get("title");
    const titleNodes = this.title ?? (typeof frontTitle === "string" ? smartenTitle([{ type: "text", value: frontTitle }]) : undefined);
    const title = titleNodes === undefined ? undefined : titleText(titleNodes);
    if (title === undefined) {
      this.errors.push(new ConverterError(this.file, 1, "document has no title: add a first-level heading or a front matter title"));
    }
    this.pageData.delete("title");
    const tags = this.tags;
    const data: PageData = { title: title ?? this.file };
    const description = this.pageData.get("description");
    if (description !== undefined) data.description = description;
    this.pageData.delete("description");
    if (tags.length > 0) data.tags = [...tags];
    if (this.file === BLOG_INDEX) data.nativeIndex = true;
    data.sourcePath = `docs/${this.file}`;
    if (this.titleId !== undefined) data.titleId = this.titleId;
    if (this.headingIds.length > 0) data.headingIds = [...this.headingIds];
    for (const key of [...this.pageData.keys()].sort()) data[key] = this.pageData.get(key);
    const info: DocInfo = {
      path: this.file,
      route: routeFor(this.file),
      title: title ?? this.file,
      titleNodes: titleNodes ?? [{ type: "text", value: this.file }],
      collection: this.collection,
      ids: [...new Set([...this.ids.all(), ...this.rawIds.keys()])].sort(),
      tags: [...tags],
      images: [...this.images].sort(),
    };
    return {
      path: this.file,
      contentId: contentIdFor(this.file),
      collection: this.collection,
      data,
      root: { type: "root", children: body },
      info,
      positions: this.positions,
      components: this.components,
      errors: this.errors,
    };
  }

  frontMatter(front: FrontMatter): void {
    for (const [key, value] of Object.entries(front.data)) {
      const line = front.keyLines.get(key) ?? front.line;
      try {
        const at = { file: this.file, line };
        this.registry.frontMatterKey(key, at).handle(key, value, at, this);
      } catch (error) {
        if (!(error instanceof ConverterError)) throw error;
        this.errors.push(error);
      }
    }
  }
}

export function convertDocument(request: ConvertRequest): ConvertedDocument {
  const converter = new DocumentConverter(request);
  const tree = parseMarkdown(request.raw);
  converter.frontMatter(parseFrontMatter(request.path, tree));
  const body = converter.convertTree(tree);
  return converter.assemble(body);
}
