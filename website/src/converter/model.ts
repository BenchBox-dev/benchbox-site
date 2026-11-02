import type { TitleNode } from "../lib/smartypants.ts";

export type SourcePosition = { file: string; line: number };

export type Collection = "docs" | "blog";

export type DocInfo = {
  path: string;
  route: string;
  title: string;
  titleNodes: TitleNode[];
  collection: Collection;
  ids: string[];
  tags: string[];
  images: string[];
};

export type ResolvedDoc = { path: string; route: string; title: string; titleNodes: TitleNode[] };

export type PageData = Record<string, unknown>;
