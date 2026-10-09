# Draft assets

Every non-Markdown file under `drafts/`, with what happens to it now that
the drafts live in this repository. Drafts are never published; published
posts and their images live in `blog/`.

| Path | Decision | Reason |
|---|---|---|
| `building-benchbox/images/*.png` (57 files) | keep | The building-benchbox drafts and outlines link to them. Each is a byte-identical copy of the published image in `blog/images/`, which the published posts use; `scripts/render-blog-charts.mjs --publish` keeps the two in step for rendered charts. |
| `building-benchbox/images/comparison_template.png` | keep | Byte-identical to `blog/images/comparison_template.png`. No draft links to it, but the published copy is a public URL, so the pair stays together until the published one is retired. |
| `building-benchbox/research/tpch-benchbox-measurements-2026-03-02.json` | keep | Measurement data behind the DuckDB TPC-H extension comparison post; `tpch-extension-vs-benchbox-implementation.md` cites it. |
| `building-benchbox/research/tpch-extension-vs-benchbox-measurements-2026-03-02.json` | keep | Measurement data behind the same post; the validation note cites it. |
| `charts/charts.json`, `charts/data/*.json` | keep | Chart definitions and inputs for `scripts/render-blog-charts.mjs`, moved from core's chart scripts. |

## Not carried over

The seed dropped every Python and shell file, so these two research
scripts stayed in core `_blog/`. Both are benchmark harnesses that run
BenchBox itself; neither belongs in a Node site, and no current draft
needs them rerun. Core deletes them with the rest of `_blog/` when the
site paths are removed.

| Core path | Decision | Reason |
|---|---|---|
| `_blog/table-formats/research/format_benchmark.py` | delete from core | It generated the table-format series' measurements. New measurements for that series should come from the published `benchbox` CLI, not a bespoke script. |
| `_blog/benchbox-in-action/research/scripts/run_platform_optimization_matrix.sh` | delete from core | A one-off driver for the platform optimization matrix runs. The `benchbox` CLI covers the same runs. |

## Rendering charts

`npm run charts -- <name>` renders a chart from `charts/charts.json` by
running the published CLI as an external tool, pinned to the bundle's
`package_version` (`uvx --from benchbox==<version> ...`). It writes to
`building-benchbox/images/`; add `--publish` to copy the result into
`blog/images/`, or `--out-dir <dir>` to write elsewhere.

Regenerating `sf1_before_after` with benchbox 0.4.2 reproduces the
published chart's text, numbers and layout. Two differences remain and
are expected: the image is cropped to its content (862 px wide instead of
the 1050 px window the published copy was captured at), and bar segments
are shaded slightly differently because a different ANSI-to-HTML
converter renders them. The published image was left unchanged.
