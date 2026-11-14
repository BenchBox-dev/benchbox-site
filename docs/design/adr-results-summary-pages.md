# ADR: Publish searchable result summary pages on their own static paths

- Status: Accepted
- Date: 2026-11-06
- Constrains: `website/src/pages/result-summaries/`, `website/src/pages/results/r/`,
  `website/src/lib/results-summary.ts`, `website/src/lib/result-receipts.ts`,
  `website/scripts/pagefind-index.mjs`, the site search dialog, and any new
  route added to the Results Explorer under `/results/`.

## Context

Pagefind indexes static HTML. The Results Explorer loads its data into
DuckDB-WASM in the browser, so none of the published platforms, benchmarks or
scores can be found through site search.

The Explorer owns every single-segment path under `/results/`: `/results/:benchmark/`
renders a benchmark for any slug, `/results/p/:platform/` a platform, and
`/results/platforms/` and `/results/benchmarks/` the indexes. The Explorer is
mounted into the site as a verified copy of its build, and the site's link gate
accepts any unresolved `/results/` link because the Explorer's 404 page routes it
client side. A static file placed under `/results/` would either collide with a
benchmark slug or depend on that fallback to be reached.

## Decision

Summary pages live outside `/results/`, under `/result-summaries/`.

| Path | Content |
|---|---|
| `/result-summaries/` | Entry page linking the two indexes |
| `/result-summaries/platforms.html` | Every published platform |
| `/result-summaries/platforms/<platform_id>.html` | One platform's published runs |
| `/result-summaries/benchmarks.html` | Every published benchmark |
| `/result-summaries/benchmarks/<benchmark_slug>.html` | One benchmark's rankings per scale factor and phase |

The ids are the Explorer's own: the `platform_id` column for a platform and the
canonical benchmark slug for a benchmark. Each page links to the matching
Explorer view (`/results/p/<platform_id>/`, `/results/<benchmark_slug>/`, and
`/results/platforms/` or `/results/benchmarks/` for the indexes) and to each
run's receipt. The Explorer's routes are unchanged and the Explorer mount is
not touched.

The data source is the core bundle snapshot (`explorer/results.duckdb`) that the
Explorer itself publishes at `/results/data/results.duckdb`. The pages are
generated while the site builds, by running the Explorer's own queries and
metric formatters against that file in Node (DuckDB-WASM), not by
reimplementing them. The core pipeline is not run, and the site reads no other
core file.

Admission follows the snapshot. A result is summarized only if its row is in
the snapshot's `results` table and its visibility is one of the indexed
`public-` states in the hosted results contract. A rejected, `private`,
`unlisted` or other non-public row never produces text, a page or a link.
Rankings come from the snapshot's `benchmark_rankings` through the Explorer's
`getBenchmarkRanking`, so rank, power score and geometric mean are the values
the Explorer shows, formatted by the same functions.

Every page states the snapshot it was built from: the core commit, the corpus
commit, the BenchBox version, the bundle production time, the SHA-256 of
`results.duckdb` and the number of published results. The build fails if the
snapshot mounted at `/results/data/results.duckdb` is not the one the pages
were generated from.

Withdrawal is handled by the build, never by editing a page. The core pipeline
removes a withdrawn result from the snapshot's derived read models. The next
site build then generates no row, and therefore no text, for it, and a
platform or benchmark left with no published results gets no page. The output
directory is rebuilt from scratch and the search index is rebuilt from that
output, so a withdrawn result is absent from pages and from search after the
next deploy. A removed page answers 404 afterwards; the static host cannot
return the 410 Gone that the hosted results contract reserves for a withdrawn
result's own detail route, which remains the Explorer's concern.

Search indexes the platform and benchmark pages in a Results section. The two
index pages are excluded from the index so that a name search returns the page
for that name.

## Amendment: one static page at every result permalink

A static page per published result is served at `/results/r/<public_result_id>`,
the permalink that every run link and the Explorer's `/results/r/:resultId` route
already use. GitHub Pages answers the extensionless path from
`results/r/<id>.html` with status 200. Paths without a file, including
`/results/r/<id>/passes`, still reach the site's 404 page, whose script hands the
path to the Explorer. The permalink directory holds only these pages, so no
Explorer route is shadowed, and the build refuses an Explorer build that ships its
own `r` directory.

Each page is the Explorer's own built `index.html` with the receipt rendered into
`<main>`, so a client without JavaScript reads the receipt and a browser loads the
Explorer, which replaces the content. The receipt fields come from the snapshot's
`result_detail_metrics` through the Explorer's formatters; the receipt section has
the id `run-receipt` that summary links target. One page exists per published result,
cloud vendors included, and the build fails if a published result has no detail row.
The pages are listed in the sitemap without the file extension and are not part of
the search index. The mount digest check covers the Explorer's files and skips the
`r` directory.

On the platform and benchmark summary pages, runs whose ranking exclusion reason is
set are listed in a separate section after the ranked runs. The section's heading and
the reasons come before its table, and each row keeps its numbers and receipt link.

## Consequences

- Nothing in `/results/` changes, the Explorer mount digest check is unaffected,
  and a future Explorer route cannot be shadowed by a static file.
- The summary pages are as fresh as the snapshot in the deployed bundle. A page
  is never newer than the Explorer it links to.
- The build needs the bundle snapshot and the DuckDB-WASM package that the
  Explorer already depends on. A new bundle field is not required.
- A result can be withdrawn only by removing it from the snapshot upstream;
  there is no site-level deny list.
