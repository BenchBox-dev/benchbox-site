---
tags: [advanced, guide]
---

# Read the documentation as Markdown

Every documentation page has a plain Markdown version, and the site publishes
an `llms.txt` file that maps the documentation. They exist for coding agents
and scripts that already use BenchBox and need to read a page without parsing
HTML. They do not help an agent find BenchBox in the first place.

## The `llms.txt` file

`https://benchbox.dev/llms.txt` follows the [llms.txt convention](https://llmstxt.org/).
It opens with a one-paragraph summary, then lists links in sections:

- Install and first run.
- CLI reference.
- MCP reference.
- Methodology.
- Result summaries.
- Every page that `docs/nav.yml` lists, grouped like the sidebar.
- Optional: pages that the navigation does not list.

The build generates the file from `docs/nav.yml` and the converted pages. A page
that the navigation omits appears under Optional, so a new page cannot go
missing. Generated per-query and compatibility pages are not listed one by one;
the listed index pages link to them.

## The Markdown version of a page

Replace the `.html` suffix of a page URL with `.md`:

| Page | Markdown version |
| --- | --- |
| `https://benchbox.dev/docs/usage/installation.html` | `https://benchbox.dev/docs/usage/installation.md` |
| `https://benchbox.dev/docs/tutorials/index.html` | `https://benchbox.dev/docs/tutorials/index.md` |

The Markdown file starts with the page title. Links to other documentation
pages point at their Markdown versions with the same `#fragment`. Links to
anything else are absolute URLs. Callouts keep the GitHub alert form
(`> [!NOTE]`), diagrams stay in `mermaid` code fences, and the invisible
anchors that the HTML pages use are removed.

GitHub Pages serves `.md` files as `text/markdown; charset=utf-8` and `.txt`
files as `text/plain; charset=utf-8`.

The Markdown versions cover the documentation pages under `/docs/`. The blog,
the result summaries under `/result-summaries/`, the search page and the
Results Explorer are HTML only. An interactive results embed becomes a link to
the HTML page.

## Related pages

- [Installation and environment setup](../usage/installation.md)
- [MCP Integration Guide](mcp-integration.md)
