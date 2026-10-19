# "Building BenchBox" Content Plan

**Concept**: Engineering decisions behind BenchBox: the trade-offs, evaluations, and design choices that shaped the tool. Not how to use BenchBox, but why it works the way it does.

**Audience**: Developers building CLI tools, open-source maintainers making build-vs-buy decisions, and BenchBox users curious about what's under the hood.

**Tone**: Exploratory, evidence-based, technically honest. We share what we tried, what worked, what didn't, and why we chose our path.

**Length**: 1,500-2,500 words per post (Architecture/Design Post type)

**Cadence**: As-needed; tied to significant engineering decisions

---

## Post Template

1. **The Problem** (200-300 words): What we needed, why existing options fell short
2. **What We Tried** (300-500 words): Libraries evaluated, approaches considered, evidence gathered
3. **What We Built** (400-600 words): The implementation, key design choices, trade-offs accepted
4. **What We Learned** (200-400 words): Takeaways, things we'd do differently, open questions
5. **Try It Yourself** (100-200 words): How readers can reproduce or explore the feature

---

## Posts

Location is the one maintained copy: published posts link their `blog/` canonical file, unpublished posts their draft or outline file. Publication order is set in `drafts/PUBLICATION_SCHEDULE.md`, not here.

| #   | Title | Location | Key Insight |
| --- | ----- | -------- | ----------- |
| 1   | Why we deleted Plotly and wrote our own ASCII charts | [Article](../../../blog/2026-02-15-why-we-deleted-plotly.md) | LLM-native tools need inline content, not file paths; zero-dep custom charting beat 10+ libraries |
| 2   | BenchBox v0.1.2 changes summary | [Article](../../../blog/2026-02-15-v0-1-2-release-summary.md) | Concise release summary of visualization, DataFrame coverage, platform expansion, and reliability updates |
| 3   | BenchBox v0.1.3 release summary | [Article](../../../blog/2026-02-23-v0-1-3-release-summary.md) | ASCII charts complete (new types, no-color fallbacks, auto-run), driver pinning/optional extras, bulk loading |
| 3   | TPC binary wrangling: shipping prebuilt dsdgen across platforms | Idea, no file yet | Cross-platform binary distribution for TPC data generation |
| 4   | DataFrame benchmarking: translating SQL to Polars/Pandas | Idea, no file yet | The challenges of faithful TPC-H translation to DataFrame APIs |
| 5   | DuckDB tpch extension vs BenchBox TPCH: same benchmark, different goals | [Article](../../../blog/2026-03-03-duckdb-tpch-extension-vs-benchbox.md) | Extension mode is ideal for quick in-engine checks, while BenchBox adds reproducibility controls and cross-platform workflow |
| 6   | Extracting textcharts from BenchBox | [Article](../../../blog/2026-03-10-extracting-textcharts.md) | Extraction forced API improvements we wouldn't have made otherwise; the process revealed hidden coupling |
| 7   | BenchBox v0.1.5 release summary | [Article](../../../blog/2026-03-10-v0-1-5-release-summary.md) | Textcharts extraction ships, table format loading lands, coverage theater replaced with mutation testing |
| 8   | BenchBox v0.2.0: Alpha to Beta | [Article](../../../blog/2026-04-01-v0-2-0-release-summary.md) | Beta promotion: cloud platform hardening, on-demand answer downloads, 80% coverage, Redshift reliability |
| 9   | BenchBox v0.2.1: MPP wave, vector search, and harmonized scale factors | [Article](../../../blog/2026-04-26-v0-2-1-release-summary.md) | 6 new platforms (Doris, CedarDB, StarRocks, SingleStore, QuestDB, Gluten+Velox), Vector Search and FlightData benchmarks, NYC Taxi expansion, ClickHouse split into 3 deployment modes |
| 10  | One SF, one gigabyte: harmonizing scale factors across BenchBox | [Article](../../../blog/2026-04-26-scale-factor-harmonization.md) | Backwards-incompatible by intent: 7 adjustable benchmarks now target ~1 GB at SF=1; spec-locked benchmarks unchanged; covers second-order constraints (TSBS quadratic growth, NYC Taxi/FlightData corpus ceilings) |
| 11  | What we built on top of SQLGlot (and why transpilation isn't enough) | [Draft](../drafts/11-what-we-built-on-top-of-sqlglot.md) | SQLGlot does the transpilation 80%; the other ~2,500 lines (dialect normalization, DataFusion semantic rewrites, QuestDB syntax fixups, 19-platform DDL registry, hand-written query overrides, SQL-to-DataFrame layer) are what production cross-engine work looks like |
| 12  | Splitting approximate analytics across BenchBox read and write benchmarks | [Article](../../../blog/2026-05-18-sketch-functions-databricks-response.md) | Approximate analytics is split across `read_primitives` one-shot aggregate queries and `write_primitives` persisted sketch-state workflows |
| 13  | BenchBox v0.3.0: JoinOrder fix, approximate analytics, and agent prompt composer | [Article](../../../blog/2026-05-18-v0-3-0-release-overview.md) | Release announcement: `/prompts/`, the JoinOrder data-contract fix, and deeper approximate/sketch coverage |
| 14  | Reworking JoinOrder around the IMDb 2013 dataset | [Article](../../../blog/2026-05-18-joinorder-imdb-2013-dataset.md) | A user-raised benchmark bug drives the post: `joinorder` now means the full IMDb 2013 JOB dataset at SF=1, with 113 query IDs, manifest-backed data identity, provenance notes, and generated data renamed |
| 15  | BenchBox v0.4.0: new org, DuckLake, and result provenance | [Article](../../../blog/2026-08-31-v0-4-0-release-overview.md) | Org move, provenance labels on the existing Results Explorer preview, DuckLake beta, and a throughput correction that needs a rerun |
| 16  | Introducing the BenchBox Results Explorer | [Article](../../../blog/2026-09-15-results-explorer-introduction.md) | Why shared results need context, Geekbench and LLM leaderboard inspiration, the result trust model, a walkthrough built on DuckDB TPC-H SF 10 releases, and the pull-request contribution path |
| 17  | How the Results Explorer qualifies comparisons | [Draft](../drafts/17-results-explorer-qualifies-comparisons.md) | The Explorer separates display, comparison, and ranking, suppresses unsupported winner claims, and keeps missing evidence visible |
| 18  | BenchBox v0.4.1: more lakehouse pairings, stricter results | [Draft](../drafts/18-v0-4-1-release-overview.md) | New lakehouse table pairings, stricter result submissions, cost reported as unavailable instead of guessed, and raised dependency floors |
| 19  | A 'spezial' new look for the benchbox project | [Article](../../../blog/2026-10-07-site-redesign.md) | Block-character logo and burgundy and cream design, with clear, consistent navigation |

---

## Key Themes

1. **Build vs. Buy with Evidence**: We don't build custom when a library works. But we evaluate thoroughly before deciding, and sometimes the evidence says "build."
2. **CLI-First, LLM-Friendly**: Design decisions that serve both terminal users and AI tool integrations (MCP).
3. **Zero-Dependency Where Possible**: Every dependency is a maintenance burden; we justify each one.
4. **Benchmarking Tools Need to Be Fast**: A benchmarking framework that's slow or bloated undermines its own credibility.
5. **Comparable Data Contracts**: Real-world benchmark datasets need provenance, identity fields, and honest scale labels, not just schema-compatible generated data.
6. **Small Surfaces Before New APIs**: When a static page can solve a handoff problem, avoid adding CLI, MCP, or JSON contracts that future releases must support.

---

*Series created: 2026-02-13*
*Last updated: 2026-10-19 (locations replace the status matrix; queue lives in `drafts/PUBLICATION_SCHEDULE.md`)*
