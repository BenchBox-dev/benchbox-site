import { HandlerRegistry } from "../registry.ts";
import { alertSyntax } from "./alerts.ts";
import { colonFenceSyntax } from "./colon-fence.ts";
import { htmlCommentSyntax } from "./comments.ts";
import { descriptionFrontMatter, holdFrontMatter, passthroughFrontMatter, tagsFrontMatter, titleFrontMatter } from "./front-matter.ts";
import { headingSyntax } from "./headings.ts";
import { imageSyntax } from "./images.ts";
import { linkSyntax } from "./links.ts";
import { mermaidFenceSyntax } from "./mermaid-fence.ts";
import { rawHtmlInlineSyntax, rawHtmlSyntax } from "./raw-html.ts";

export function createDefaultRegistry(): HandlerRegistry {
  return new HandlerRegistry()
    .register(imageSyntax)
    .register(rawHtmlSyntax)
    .register(rawHtmlInlineSyntax)
    .register(colonFenceSyntax)
    .register(alertSyntax)
    .register(mermaidFenceSyntax)
    .register(htmlCommentSyntax)
    .register(headingSyntax)
    .register(linkSyntax)
    .register(passthroughFrontMatter)
    .register(holdFrontMatter)
    .register(titleFrontMatter)
    .register(descriptionFrontMatter)
    .register(tagsFrontMatter);
}
