# ADR: Author the documentation in plain Markdown and retire the MyST dialect

- Status: Accepted
- Date: 2026-11-02
- Supersedes: the decision to keep MyST as the documentation dialect when the
  Sphinx build was replaced by the Astro site.
- Constrains: `docs/`, `blog/`, `docs/nav.yml`, the site converter under
  `website/src/converter/` and the generators under
  `website/src/lib/docs-generators/`.

## Context

The documentation was written in MyST, a Markdown dialect with directives,
roles, labels and definition lists. Sphinx rendered it until it was removed
from core. Since then the site's own converter has been the only program that
reads the dialect, so every MyST construct cost a handler, a test and a
golden file, and none of it rendered on GitHub or in an editor preview.

The documentation now lives in this repository, and so does everything that
produces MyST: the authored pages and the two generators for the query
templates, the tag pages and the section indexes. Core's remaining MyST sits
in maintainer-only pages that the site never publishes. The question was
whether to keep the dialect and its converter or to convert the sources once.

## Decision

The sources are plain GitHub-flavoured Markdown. The converter stays, because
it is also the only pipeline for link resolution, heading ids, the blog, tag
pages and the sidebar, but it no longer understands MyST.

- The sidebar is an explicit tree in `docs/nav.yml`. A page is a path, with an
  optional label and children. The tag groups are generated from the tags.
- Tags are the `tags` list in front matter. The tag pages keep their URLs.
- References are ordinary relative `.md` links with the target's title as the
  link text. Old label and `{#id}` anchors stay as `<span id>` lines, so
  published fragments keep working. Heading ids keep the existing algorithm,
  so no heading anchor changes.
- Admonitions are GitHub alerts (`> [!NOTE]`), diagrams are `mermaid` code
  fences, tables are pipe tables, and definition lists are bold lead-in
  paragraphs.
- Index pages list their children as a flat Markdown list. The nested section
  lists that the old contents directive generated are gone.
- The blog index is rendered by the blog template from the published posts.
- A permanent guard in the converter (`myst-guard.ts`) fails the build, with
  file and line, on a directive fence, a role before an inline code span, a
  `(label)=` line and a `myst` front matter key, so MyST cannot return unnoticed and render as stray text.
- The site no longer publishes `objects.inv`, the Sphinx cross-reference
  inventory. Sphinx is gone, nothing consumed the file, and it is removed from
  the build, the manifest, the deploy probe and the route probe.

## Consequences

- Pages render the same on GitHub as on the site, and the converter shrinks by
  its directive, role, label and definition-list handlers.
- Navigation is separate from page content. A new page that should appear in
  the sidebar needs one line in `docs/nav.yml`; an unlisted page still builds.
- Link text no longer follows a later title change in the target page.
- Deprecated notes show the title Warning with a bold "Deprecated since"
  lead-in, and definition lists render as paragraphs.
- Core's tests that lock documentation text, the links from core's README and
  the release marker that `benchbox/utils/version.py` reads from
  `docs/README.md` are not affected, because none of them depend on MyST
  syntax.
