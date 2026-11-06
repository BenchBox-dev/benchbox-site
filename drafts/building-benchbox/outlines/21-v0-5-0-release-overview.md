---
title: "BenchBox v0.5.0: one SQL translator, execution engines, and tuning that fails loudly"
series: building-benchbox
post_number: 21
type: release-notes
tags: [benchbox, release, sqlglot, execution-engines, tuning, tpch, qphh, security, results-explorer]
status: OUTLINED
updated: 2026-11-06
---

# Outline: BenchBox v0.5.0 release overview

## Purpose

Release announcement in the post-15 shape: what shipped, why it matters, how
to try it, then what breaks. Not a GitHub-release-notes page and not the
SQLGlot fork story (outline 20 owns that). The reader's job after this post is
to decide whether to upgrade now and which saved results to rerun.

## Audience

- Existing BenchBox users on any 0.4.x deciding whether to upgrade. v0.4.2
  (October 5) had no post and the v0.4.1 post is unpublished, so some readers
  last read about v0.4.0.
- Users who publish results and want to know why 25 rows left the rankings
  and what replaced them.
- Readers who maintain tuning files, saved credential profiles or scripts that
  use the Python API, who need the migration table more than the features.

## Thesis

v0.5.0 trades continuity for correctness: every install now translates SQL
with the same bundled SQLGlot, a run records how a query actually executed
(deployment, execution engine, gateway, container), and tuning a platform
cannot apply stops the run instead of being silently skipped. The price is a
long list of baselines to rerun.

## Reframe (L3)

The changelog reads as a feature list with 18 "Before you upgrade" bullets.
The real news is that most of those bullets change the numbers readers
already have. Organize the post around "what your existing results mean now"
rather than around the Added section: translation first, then execution
evidence, then tuning, then the fixes that change answers. The Added items
(selectors, engines, refresh functions, GizmoSQL) support that frame instead
of leading it.

## Governing constraints

Satisfy these by omission or by stating the affirmative scope once.

- The bundled translator is `benchbox-sqlglot` 30.29.0.1 on SQLGlot 30.29.0,
  shipped inside the wheel (`benchbox._vendor`, a zip plus
  `SQLGLOT_LICENSE.txt`). It is **not** a PyPI package (pypi.org returns 404
  for `benchbox-sqlglot`) and the fork repository is not publicly readable at
  `BenchBox-dev/benchbox-sqlglot` (GitHub API 404 on 2026-11-06). Do **not**
  tell readers to install it, link the repo, or quote outline 20's figures
  (419/124/43/20, wheel size, import time); those predate 30.29.
- Give the fork rationale one sentence (translation bugs changed answers; the
  translator is now part of the release). Do **not** promise a follow-up post
  and do **not** link post 11 or outline 20: neither is published.
- Do **not** say the Results Explorer is new or launched. Phase 1 launched
  2026-04-04. v0.5.0 removes 25 ranked results and adds 58 replacements for
  ClickHouse Local, DataFusion and SQLite; say exactly that.
- Do **not** call the removed results "wrong" as a group. The changelog says
  "built on superseded SQL translations or wrong values"; keep both halves.
- Do **not** list all 18 upgrade bullets. The post carries the ones that
  change a decision; the changelog link carries the rest.
- "Deprecated spellings stop working in 0.6.0" is the changelog's statement.
  Repeat it as a plan, not a date.
- TPC-H refresh functions run only on DuckDB, SQLite, PostgreSQL, Snowflake
  and SingleStore. State the list wherever QphH@Size appears.
- Gateway results "are never official"; macOS/Windows Docker server engines
  rank as container runs. State both when introducing gateways.
- Sentence case after the colon in the title. No em-dashes.
- Smoke commands use `--scale 0.01` and `uv run -- benchbox`.
- No contributor thanks unless a named handle is verified in the release.

## Evidence boundary

- Shipped code and package: tag `v0.5.0` (commit `dfe585e0`, 2026-11-05
  16:22 -0500), PyPI 0.5.0 (uploaded 2026-11-06 02:55 UTC), GitHub release
  published 2026-11-06 02:55 UTC. Five release candidates preceded it
  (`v0.5.0rc1`-`rc5`); do not narrate them.
- Release date in the post: **November 4, 2026**, the changelog heading, per
  the post-15 precedent (changelog date, not publication timestamp). Joe
  decides if November 5 or 6 is preferred; pick one and do not explain.
- Fact source: `BenchBox/CHANGELOG.md` `[0.5.0]` section. Every number in
  the post (25/58, 30.29.0.1, certifi 2026.10.19, grpcio 1.84.1, uv 0.13.4,
  schema 2.3, 90 of 99 TPC-DS queries on OBT, 5% free disk, JoinOrder 5 GiB
  vs 9 GiB on Polars, 3 GiB vs 7 GiB on DataFusion) comes from there.
- Explorer figures: read the deployed snapshot on the drafting date and record
  its SHA-256 and row count, as post 15 did. Confirm the 25 removed and 58
  added against it before publishing.
- Registry and platform counts, if used: `doc-contracts.json` in the bundle
  the site builds from, not memory.
- Hero image candidates (one, saved under `../images/`): a terminal capture
  of `benchbox tuning validate` rejecting a tuning file with the type and
  reason, or a result-file excerpt showing requested vs observed execution
  engine. Alt text describes what the image shows.

## Structure and word budget

Target: 1,400-1,800 words. Longer than post 15 because the migration table
is larger; still one screenshot, no "Release highlights" list that
duplicates At a glance.

1. Opening and TL;DR (~200 words). Three sentences: same translator in
   every install; runs record how they executed; tuning fails instead of
   skipping. One connective sentence on reruns. Release date. Hero image.
2. At a glance: 8-row Area / What changed / Why it matters table.
   - SQL translation: bundled SQLGlot 30.29.0.1; public `sqlglot` no longer
     installed / two users comparing runs compare platforms, not translators.
   - Deployment selectors: `--platform name:mode` on more platforms, in MCP
     and Python; `compute_resource`, `compute_size` / each deployment ranks
     separately.
   - Execution engines: `--execution-engine` for Polars, Dask, pg-duckdb /
     results record requested and observed engine.
   - TPC-H refresh and QphH: RF1/RF2, `benchbox metrics qphh` / QphH@Size on
     five platforms; subscale runs rank in their own cohort.
   - Tuning: unapplicable tuning fails; `benchbox tuning validate`; results
     list ignored tuning / a tuned result means the tuning applied.
   - Security: certifi 2026.10.19, grpcio 1.84.1 for the emSign CA incident;
     submission salt / older releases trust compromised CAs.
   - Wrong answers fixed: TPC-DI, ClickHouse, DataFusion, Doris, StarRocks,
     QuestDB / rerun those baselines.
   - Published rankings: 25 removed, 58 added / Explorer rows reflect the
     new translator.
3. One translator per install (~250 words). What was happening before
   (BenchBox installed public `sqlglot`; translation depended on the user's
   version). What ships now. Which engines get different SQL (the changelog
   list: SQLite, ClickHouse, Spark, Databricks, QuestDB, DataFusion,
   PostgreSQL, Trino, Presto, Athena, SingleStore; some Read Primitives on
   DuckDB, BigQuery, StarRocks). STDDEV/VARIANCE sample form on MySQL, Doris,
   StarRocks, SingleStore. Results record the translator version. The
   Explorer removal/replacement. Faster import: SQLGlot loads on first
   translation; `run` loads one adapter.
4. Recording how a query ran (~250 words). Deployment selectors with two
   examples (`firebolt:cloud`, `pg-duckdb:motherduck`). Execution engines
   with the three platform pairs. Gateways on Snowflake and Databricks, never
   official. Container runs on macOS/Windows. Engine version recorded on
   DuckDB, SQLite, DataFusion; live Spark/LakeSail/Velox settings.
   `benchbox compare` refuses heterogeneous results without
   `--allow-heterogeneous-comparison`. GizmoSQL experimental, one sentence.
5. TPC-H refresh functions and QphH@Size (~150 words).
   `--benchmark-option tpch_refresh_functions=true`, the five platforms, the
   subscale cohort for SF < 1, Throughput stream numbering 1..S and power on
   stream 00, no Throughput@Size on a query subset.
6. Tuning that fails instead of pretending (~200 words). The old behavior
   and why it was misleading. `benchbox tuning validate <file> --platform`.
   Unknown YAML keys fail. New tuning on PostgreSQL, CedarDB, Citus,
   ParadeDB, pg_mooncake. `--dry-run --tuning tuned` without the driver.
   Tuned runs that used to abort now run (PostgreSQL, Athena, Synapse,
   Fabric Warehouse, BigQuery). New platform reference page.
7. Security (~120 words). emSign CA incident with the Python advisory link;
   the floors; what an attacker could do on older releases. Private
   submission salt; secrets out of dry-run previews.
8. Fixes that change answers (~150 words). The wrong-answer list grouped by
   benchmark. Database drop guard on validation mismatch. Disk space check.
   JoinOrder memory figures. Loads that got faster (ANALYZE, SQLite indexes).
9. Changed behavior to be aware of: migration table. Rows: option spellings
   (`deployment_mode`, `warehouse`, `--polars-streaming`); `translate_sql_query`
   `rewrites`; `run_throughput_test`/`run_official_benchmark` need `adapter=`
   and 2 streams; `create_server()` vs `run_server()` logging; ParadeDB
   `pg_search` image; SingleStore no `cloud` mode; Databend HTTP 8000;
   previously ignored options now apply (DuckDB `threads`, SQLite
   `database_path`, profile overrides); DuckDB `auto` and ClickHouse
   `benchbox_<benchmark>_<scale>` rebuilds; certifi vs system store
   (`REQUESTS_CA_BUNDLE`); uv 0.13.4 for source checkouts; result schema 2.3;
   `stream_timeout_seconds` applies to Throughput; Spark driver heap 60%.
10. Try it yourself (~150 words): `uv run -- benchbox --version`;
    `uv run -- benchbox tuning validate <file> --platform duckdb`; DuckDB
    TPC-H at 0.01 with `--benchmark-option tpch_refresh_functions=true`
    then `uv run -- benchbox metrics qphh`; Polars run with
    `--execution-engine streaming`; Explorer URL.
11. References: changelog section, Python advisory, platform tuning
    reference page, Results Explorer. No SHA footnotes.

## Editorial risks

| Risk | Mitigation |
| --- | --- |
| Post becomes the SQLGlot fork essay | ~250 words, one rationale sentence, no fork links; outline 20 owns the story |
| "Install benchbox-sqlglot" or a fork repo link | Vendored in the wheel; PyPI and GitHub both 404 on 2026-11-06 |
| Quoting outline 20's corpus counts | They predate 30.29; use only 25 removed / 58 added, confirmed against the snapshot |
| Three plausible release dates | Changelog date, November 4, stated once |
| Migration table swallows the post | Table is late, one row per change, no prose repeats |
| QphH@Size read as universal | Name the five platforms beside every QphH mention |
| Gateway or container runs read as official | "Never official" and "ranked as container runs" stated at introduction |
| Removed Explorer rows read as all wrong | Keep "superseded SQL translations or wrong values" |
| Readers on 0.4.2 see nothing about it | One sentence plus a link to the 0.4.2 changelog section; no v0.4.2 recap |
| Synthetic contributor thanks | Maintainer-driven cycle unless a handle is verified |
| Linking unpublished posts 11, 18 or 20 | Link only `blog/` files that exist on `main` |
