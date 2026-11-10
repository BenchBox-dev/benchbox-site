# Outline: TPC-DS OBT rebuilt: from a query converter to a catalog we own

> The one-big-table variant of TPC-DS used a query converter that had drifted from
> TPC-DS itself. It is now a hand-owned catalog that runs 90 of the 99 queries and
> records why each of the other nine is excluded.

**TL;DR**: TPC-DS OBT runs the TPC-DS queries against one 715-column table. Until
v0.5.0 a converter rewrote the TPC-DS templates at startup, and over time its
output stopped matching TPC-DS: parameters rendered as `0`, queries that could not
return rows, and no check against the TPC-DS answer. OBT 0.2 replaces it with a
static YAML catalog. Each entry is pinned to a TPC-DS template by SHA-256, takes
its parameters from the dsqgen draw, and is compared with TPC-DS on DuckDB at SF0.01
and SF1. The catalog serves 90 queries and names the nine it cannot serve, with a
recorded reason for each. Published OBT results from before the rebuild are flagged,
and three local ones have been replaced.

---

## Metadata

```yaml
title: "TPC-DS OBT rebuilt: from a query converter to a catalog we own"
series: building-benchbox
post_number: 22
type: architecture-design
target_length: 1500-2000
tags: [benchbox, tpc-ds, tpcds-obt, one-big-table, benchmark-design, query-catalog, dsqgen, correctness]
status: published (blog/2026-11-10-tpcds-one-big-table.md)
updated: 2026-11-07
```

## Post definition

| Field | Decision |
|---|---|
| Thesis | A derived benchmark is only as good as its link to the original. A converter that regenerates queries at startup hides drift; a catalog that pins each query to a template hash, draws parameters from dsqgen, and is checked against TPC-DS Qn makes the link testable. Where a query cannot be expressed on one table, we say so per query instead of serving a different query under the same number |
| Audience | BenchBox users who ran or read TPC-DS OBT results and saw "OBT 0.2, 90 of 99" in the v0.5.0 notes. Secondarily, people building a derived or denormalized variant of a standard benchmark |
| Tone | `we`, plain, claims tied to a number or named condition. No em-dashes or en-dashes. Neutral on platforms: say which engines the evidence covers, do not rank them. The old converter's drift is described as a design weakness, not a person's mistake |
| Publication state | Shipped in v0.5.0 (`CHANGELOG.md:10` heading `[0.5.0] - 2026-11-04`; OBT benchmark version string `"0.2"` at `benchbox/core/tpcds_obt/benchmark.py:61`). Write in past and present tense. Nothing is direction except Section 8 |
| Relation to post 20 | [Post 20](../drafts/20-why-benchbox-ships-its-own-sqlglot-fork.md) gives OBT one paragraph (draft line 68) and promises this post ("That rebuild is a post of its own"). Link it once in the opening. Post 20 also states the audit figures (124 / 43 / 73 and "three cloud OBT bundles not rerun for cost"); cite them as post 20's figures, do not re-derive them |
| Relation to post 21 | [Post 21](../../../blog/2026-11-06-v0-5-0-release-overview.md) line 94 says "TPC-DS OBT 0.2 uses a wider table, runs 90 of the 99 TPC-DS queries and returns the TPC-DS answers." Link it once. Do not repeat its migration list |

## Section plan

### TL;DR (~70 words)

As above.

### 1. Why a one-big-table variant exists (~220 words)

- TPC-DS OBT adapts TPC-DS to one denormalized table instead of 25 normalized ones
  (`docs/benchmarks/tpc-ds-obt.md:15`). The stated uses are column pruning, wide
  table scans and storage formats such as Parquet, Delta and Iceberg
  (`docs/benchmarks/tpc-ds-obt.md:17`, site repo). It is marked experimental
  (`CHANGELOG.md:972`, verify still current at v0.5.0).
- What "one big table" denormalizes, exactly (read from `model.yaml`, not from the
  older doc table, see verify list):
  - One table, `tpcds_sales_returns_obt` (`benchbox/core/tpcds_obt/schema.py:15`;
    `model.yaml:2`).
  - Grain: one row per sale line across three channels (`store`, `web`, `catalog`),
    with the matching return joined onto the sale by ticket or order number and
    item (`model.yaml:3-12`). A `channel` column discriminates; a channel with no
    source for a column writes NULL (`lineage.py` header text, verify exact line).
  - Dimensions are joined in under role prefixes such as `sold_date_`,
    `return_date_`, `item_`, `store_` (`model.yaml:183-210`). 715 columns at
    `dimension_mode=full`, 424 at `minimal` (computed with
    `get_obt_columns(mode)` on `develop` at `fbb2278152`; verify before drafting).
  - The 0.2 table gained 12 roles and 197 columns, 518 to 715 (`CHANGELOG`
    entry in commit `14bf4205b2`, PR #3361).
- Say plainly what OBT is not: it is not TPC-DS and it is not a compliant TPC-DS
  run. Normalized TPC-DS stays the compliance workload
  (`docs/benchmarks/tpc-ds-obt.md:41`).
- The promise a variant makes: query Qn on the big table returns what TPC-DS Qn
  returns. The rest of the post is about keeping that promise.

### 2. How the converter drifted, and what it did to results (~330 words)

- What it was: `query_conversion.py` (1,568 lines), a `QueryConverter` that parsed
  each TPC-DS template with SQLGlot and rewrote the tree onto the OBT, with a
  `ColumnMapper`, per-query role inference, six `_post_process_fix_*` passes, a
  `query_specs.yaml` list of `convertible_query_ids` and `blocked_query_ids`, and
  `manual_queries.py` with hand-written SQL for Q14 and Q49. All at
  `git show 2dd7f7cbdc^:benchbox/core/tpcds_obt/...` (deleted by PR #3353).
  At the end it converted 89 queries by the old spec (89 ids in
  `convertible_query_ids`, computed from the old `query_specs.yaml`; verify) and
  blocked 10: 21, 22, 37, 39, 46, 64, 68, 72, 82, 84.
- Why that design drifts: the output was generated in memory every run, so nothing
  recorded what SQL a given query was supposed to be, and no test compared it with
  TPC-DS. A change in the converter, in SQLGlot, or in a template changed the
  benchmark without a diff anyone could review.
- Three recorded forms of drift, each with its fix (cite PRs; dates are merge dates
  from `gh pr view`):
  1. **Parameters.** The converter rendered every `dist()` and `sub()` parameter as
     `0`, took the first value of `random()` and `text()` parameters, used its own
     random generator for `ulist()`, and collapsed indexed references such as
     `[LISTPRICE.1]` to `[LISTPRICE.6]` into one value. Q93 filtered on
     `r_reason_desc = '0'` and many statements returned no rows (PR #3062, merged
     2026-10-17; commit message of `5af97291b1`; `results-data/CORPUS_NOTES.md:245`).
  2. **Queries that could not return rows.** Returned-date joins used the wrong
     role, current-pointer equalities could not be satisfied on a wide table, and
     cross-channel and multi-warehouse subqueries were not correlated on distinct
     OBT aliases (PR #3120, merged 2026-10-18; commit message of `eb11f35ca6`).
  3. **Answers that differed from TPC-DS.** The 0.2 work rewrote 37 queries as
     one-table SQL, brought Q46, Q64 and Q68 into the served set, and found that Q8
     and Q54 (served by the old converter) cannot be expressed on the table, joining
     Q84 and the inventory queries as exclusions (PR #3380, merged 2026-10-24;
     `CHANGELOG` entry in commit `2270a26145`). Q2 had built its calendar from sales
     rows, so it only matched at some scale factors; it now uses the TPC-DS date
     table's fixed week and year boundaries (same entry).
- What it did to results: the six published SF1 OBT bundles (BigQuery, ClickHouse
  Local, Databricks, DataFusion, DuckDB, Snowflake) ran with the broken parameters.
  Each manifest carries `known_defects: ["defective-tpcds-obt-parameters"]`, which
  removes it from rankings (`results-data/CORPUS_NOTES.md:245-262`).
- How it was noticed: the record shows Q93 filtering on `'0'` and returning no rows
  (`CORPUS_NOTES.md:247-253`). **Not found in the repos: who noticed it and what
  prompted the audit.** Ask the author before drafting; if no answer, write only
  what the commit message records.
- Keep this section about the mechanism. Name the data (a query returning no rows
  and still finishing quickly looks like a fast query), not blame.

### 3. Why a hand-owned catalog instead of a better converter (~260 words)

- The decision is PR #3353, "load OBT queries from a static catalog and delete the
  converter" (merged 2026-10-23, commit `2dd7f7cbdc`): +8,393 lines in
  `catalog/queries.yaml`, minus 1,568 (`query_conversion.py`), 454
  (`manual_queries.py`), 179 (`query_specs.yaml`); 16 files changed.
  Rendered SQL was unchanged by the swap itself (`CHANGELOG` entry in that commit).
- Reasons, each tied to something in the code:
  - The SQL is data in a reviewable file. A reviewer reads a diff of one query, not
    a diff of a rewriting engine.
  - Hard queries were already hand-written (`manual_queries.py` had Q14 and Q49;
    0.2 hand-rewrote 37 more). A converter that is mostly special cases is a
    catalog with extra steps.
  - `benchbox/core/tpcds_obt` no longer imports SQLGlot; a test enforces it
    (`tests/unit/core/tpcds_obt/test_tpcds_obt_catalog.py`, `test_obt_package_does_not_import_sqlglot`).
    Link this to post 20: the OBT queries are no longer subject to translator
    changes at generation time. Platform translation of the finished SQL still goes
    through `translate_sql_query` (`CHANGELOG` entry in commit `2dd7f7cbdc`: Doris
    and StarRocks derived-table aliases).
  - Startup no longer converts 89 queries.
- Catalog shape (`benchbox/core/tpcds_obt/catalog/loader.py:33-56`): per entry `id`,
  `template`, `template_sha256`, `parameters` (name to indices), optional
  `identifier_parameters` and `identifier_map`, and `sql` with `[NAME]` or
  `[NAME.nn]` placeholders. File is `queries.yaml`, version 1, 7,314 lines
  (`queries.yaml:1`, `wc -l`). Show one short entry (Q1 is at `queries.yaml:2-17`
  for the header; do not paste its full SQL).
- The honest cost: 90 hand-owned queries are 90 things to keep correct by hand.
  The checks in Section 5 exist to make that cost bounded.

### 4. What the 90 cover and why 9 are out (~380 words)

- The catalog covers 90 of the 99 TPC-DS query ids and `excluded:` names the rest
  (`queries.yaml:7278`; `loader.py` `load_exclusions`; test
  `test_catalog_covers_every_tpcds_query_or_names_the_exclusion`,
  `test_tpcds_obt_catalog.py:71-75`, requires `ids | excluded == set(range(1, 100))`).
- Asking for an excluded query raises `QuerySkippedError` with the recorded reason
  (`benchbox/core/tpcds_obt/queries.py:_get_query`; test at
  `test_tpcds_obt_catalog.py:88-91`). Nothing is served under that number.
- Table, one row per exclusion, reason copied verbatim from the catalog:

| Query | Recorded reason (`queries.yaml`) | Line |
|---|---|---|
| Q8 | Needs customer zip codes and stores that have no sales rows; the OBT only carries dimension rows reachable from a sale line. | 7282 |
| Q21 | Reads the inventory fact table, a separate fact domain the OBT does not carry. | 7286 |
| Q22 | Reads the inventory fact table, a separate fact domain the OBT does not carry. | 7290 |
| Q37 | Reads the inventory fact table, a separate fact domain the OBT does not carry. | 7294 |
| Q39 | Reads the inventory fact table, a separate fact domain the OBT does not carry. | 7298 |
| Q54 | Needs customers and stores that have no sales rows; the county and state match runs over every customer and store. | 7302 |
| Q72 | Reads the inventory fact table, a separate fact domain the OBT does not carry. | 7306 |
| Q82 | Reads the inventory fact table, a separate fact domain the OBT does not carry. | 7310 |
| Q84 | Needs customers that have no sales rows; the query joins customers to store returns through the customer's current address and income band. | 7314 |

- Two groups, as in `docs/benchmarks/tpc-ds-obt.md:141-146`: six inventory queries
  (Q21, Q22, Q37, Q39, Q72, Q82) and three "dimension rows with no sales" queries
  (Q8, Q54, Q84). Each exclusion also stores the template's SHA-256 so a changed
  template invalidates the claim (`test_exclusions_state_a_reason_and_pin_the_template`,
  `test_tpcds_obt_catalog.py:80-85`).
- What would bring them back, stated as design, not promise: the inventory six need
  a second fact domain in the table or a second table; the other three need
  dimension rows that no sale references. Both change what "one big table" means.
  Mark this as reasoning, not a roadmap item (verify no TODO exists).
- Lettered statements: Q14, Q23 and Q24 run as `14a`/`14b`, `23a`/`23b`, `24a`/`24b`
  to match base TPC-DS, so a run reports 93 ids, not 90 (PR #3491, merged
  2026-10-25; `CORPUS_NOTES.md:858-875`; `queries.py:split_variant` and
  `_select_statement`). Say this once so "90 versus 93" does not confuse readers.

### 5. How Qn is kept faithful to TPC-DS Qn (~400 words)

Four checks, in order of how early they fail. Do not name Make targets beyond the
one users can run.

- **Parameters come from dsqgen.** `TPCDSOBTQueryManager.drawn_parameters` calls
  `DSQGenBinary.generate_parameter_log(query_id, seed, scale_factor, stream_id)`
  and renders the logged substitutions into the catalog SQL
  (`queries.py:drawn_parameters`; `benchbox/core/tpcds/c_tools.py:243`). Overrides
  use the dsqgen key form `NAME.nn`, so `ZIP.1` and `ZIP.01` mean the same thing
  (PR #3062 commit message). `identifier_map` translates drawn source column names
  such as `sr_return_amt` to the OBT's `return_amount` (`queries.yaml:11-18`).
- **Template pinning.** `template_sha256` must match the bytes of the TPC-DS
  template shipped with BenchBox. A changed template fails
  `test_template_sha256_matches_the_tpcds_source` (`test_tpcds_obt_catalog.py:96`)
  with "re-derive the catalog entry".
- **Placeholder and define checks.** Every placeholder in the SQL must be declared,
  and a declared parameter must be defined by the template
  (`loader.py:_parse_entry`, the `used != declared` check;
  `test_placeholders_match_the_dsqgen_defines`, `:102`). Every column the draw can
  select must have an OBT mapping (`test_identifier_map_covers_the_dsqgen_choices`,
  `:115`).
- **Answer equivalence.** `tests/integration/test_tpcds_obt_equivalence.py` builds
  both schemas on DuckDB from the same dsdgen data and compares each served query
  with TPC-DS (`make tpcds-obt-equivalence`, `Makefile:375-377`, default SF0.01;
  run again at SF1). The recorded result: no served query is listed as divergent at
  either scale (`DIVERGENT_AT_SF_0_01 = {}` at `:37`, `DIVERGENT_AT_SF_1 = {}` at
  `:60`; `CHANGELOG` entry in `2270a26145`).
- State the limit of that check honestly, from the same file: equality can be
  vacuous. At SF0.01, 19 queries are listed as unverifiable because the base query
  returns no rows, only NULL or 0 aggregates, or one warehouse makes it degenerate
  (`:38-57`); at SF1, three remain (Q23, Q24, Q61; `:61-65`). The seed search tries
  `None` and 1 to 12 and takes the first non-vacuous draw
  (`tests/integration/_tpcds_obt_utils.py:15`, `choose_seed` at `:135`). A reader
  should leave knowing which queries are proven equal on data and which only on
  structure. Link the same lesson in post 20 section 4 ("an equality check can pass
  vacuously") in one clause.
- Lettered Q24 gets a dedicated test with parameters that return rows, run from
  SF1 (`test_q24_matches_tpcds_with_parameters_that_return_rows`, `:131-132`).

### 6. What this means for published OBT results (~280 words)

- Two separate changes, kept apart in the text:
  1. **Parameters (PR #3062, 2026-10-16/17).** Six SF1 bundles flagged
     `defective-tpcds-obt-parameters` and removed from rankings
     (`CORPUS_NOTES.md:245-262`). Three manifests were created for bundles that had
     none, recording `result_source: internal` (same section).
  2. **Benchmark definition 0.2 (PR #3361/#3380).** The table is wider and the
     served set is 90, so any OBT result from before needs a rerun
     (`CHANGELOG` entry in `14bf4205b2`: "published SQL OBT results need a rerun";
     `CHANGELOG.md:26`).
- What has been rerun: three local SF1 bundles on the lettered catalog, DuckDB,
  DataFusion and ClickHouse Local, merged 2026-10-26 (PR #3550;
  `CORPUS_NOTES.md:858-870`):
  - DuckDB `tpcds_obt_sf1_duckdb_sql_20261026_090851_b4cd9b9e`: 93 served queries,
    279 measured executions, 0 failures; 5,041,336 rows loaded.
  - DataFusion `tpcds_obt_sf1_datafusion_sql_20261026_091037_b6577a1e`: 93 served
    queries, 0 failures.
  - ClickHouse Local `tpcds_obt_sf1_clickhouse_local_sql_20261026_132451_e8646728`:
    chDB 4.1.6, 93 served queries; Q41 and Q44 fail on this engine with
    `NOT_IMPLEMENTED` (documented exclusions, `CORPUS_NOTES.md:880-890`).
  - Quote the load times only with their condition (DuckDB 148.6 s, ClickHouse
    Local 579.2 s, different environments: ClickHouse ran in a Linux container).
    Better to leave load times out and avoid a cross-engine comparison.
- What has not: three cloud OBT bundles (BigQuery, Snowflake, Databricks;
  `480ffcea`, `d35974f6`, `d11b3297`) stay flagged because rerunning needs spend
  approval (`CORPUS_NOTES.md:1472`, `:1533`). They remain in the corpus, labelled
  and unranked. Point to post 20's figures for the counts.
- Seven ids return no rows at SF1 with the default draw (Q23b, Q24a, Q24b, Q25,
  Q29, Q41, Q58), and so do the same ids in plain TPC-DS on the same DuckDB database
  (`CORPUS_NOTES.md:874-880`). Say so: an empty result there is the TPC-DS answer,
  not an OBT defect, and the reader should not read those timings as work done.
- Note the Q93-style failure mode in one sentence: a query that returns nothing is
  fast. This is why "returns the TPC-DS answer" is the first claim, ahead of any
  timing.

### 7. Limitations (~150 words)

- OBT is not TPC-DS and does not claim compliance; it measures wide-table behavior.
- Nine of 99 queries are not served, and the six inventory queries are a whole fact
  domain, so the 90 do not exercise inventory-shaped work.
- Equality at SF0.01 is vacuous for 19 queries and at SF1 for three (Section 5);
  two scale factors and one reference engine (DuckDB) is the evidence, not every
  platform.
- Platform evidence: local engines were rerun for SF1 (three). Cloud platforms have
  no current bundle. Platform list in the docs (DuckDB, ClickHouse, Databricks,
  Snowflake, BigQuery, Polars full; PostgreSQL limited,
  `docs/benchmarks/tpc-ds-obt.md:206-214`) describes support, not fresh results;
  verify against v0.5.0 before quoting.
- ClickHouse Local fails Q41 and Q44 on chDB 26.1 (`CORPUS_NOTES.md:880-890`).
- The catalog is hand-owned. Template changes fail tests, but the rewritten SQL is
  only as right as its reviewer and the equivalence run.

### 8. What to do next (~90 words)

- Upgrade to v0.5.0 and rerun OBT workloads; do not compare against pre-0.2 OBT
  results (`CHANGELOG.md:26`).
- Run `benchbox run --platform duckdb --benchmark tpcds_obt --scale 1`
  (`docs/benchmarks/tpc-ds-obt.md:87`) and check that Q93-style queries return rows.
- Expect `QuerySkippedError` for the nine; the message names the reason.
- Report an OBT query whose answer differs from TPC-DS with query id, scale factor
  and platform.
- Link the column lineage page (`docs/benchmarks/tpc-ds-obt-lineage.md`) for what
  each of the 715 columns comes from.

### References (short)

- BenchBox PRs (merge dates from `gh pr view`):
  - #3062 render parameters from the dsqgen draw (2026-10-17);
  - #3120 conversions that could not return rows (2026-10-18);
  - #3353 static catalog, delete the converter (2026-10-23);
  - #3361 one model for ETL, DDL and lineage, 12 roles (2026-10-24);
  - #3380 OBT queries return TPC-DS results, record Q8, Q54, Q84 (2026-10-24);
  - #3491 lettered statements and Q95 (2026-10-25);
  - #3550 OBT SF1 reruns with ClickHouse Q41/Q44 exclusions (2026-10-26);
  - #3788 bound OBT generation memory (2026-10-30; `CHANGELOG.md:58` says
    "TPC-DS OBT generation is capped at 6 GB of memory");
  - #3524 SQLGlot fork adoption for PostgreSQL OBT (commit `1326cae289`,
    `CORPUS_NOTES.md:221`).
- Code: `benchbox/core/tpcds_obt/` (`catalog/queries.yaml`, `catalog/loader.py`,
  `queries.py`, `model.yaml`, `schema.py`); tests
  `tests/unit/core/tpcds_obt/test_tpcds_obt_catalog.py` and
  `tests/integration/test_tpcds_obt_equivalence.py`.
- Results notes: `results-data/CORPUS_NOTES.md` sections "TPC-DS OBT parameter defect
  (2026-10-16)" and "TPC-DS OBT SF1 reruns on the lettered catalog (2026-10-26)".
- Docs (this repo): `docs/benchmarks/tpc-ds-obt.md`, `docs/benchmarks/tpc-ds-obt-lineage.md`.
- Published: [Post 21](../../../blog/2026-11-06-v0-5-0-release-overview.md).
  Draft: [Post 20](../drafts/20-why-benchbox-ships-its-own-sqlglot-fork.md).
- Internal, not to be linked: `_project/decisions/cross-surface-scope-and-release-posture-2026-09-27.md:37`
  (notes an abandoned OBT-native Q1..Q17 correspondence; context only).

## Drafting notes

- The tension to hold: a variant is only useful if "Q17" means Q17. Open on the
  failure (Q93 filtering on `'0'`, a query that finishes fast because it returns
  nothing), then show the design that makes the failure testable. Do not open on
  the catalog.
- The nine exclusions are the credibility of the post. Keep the table verbatim and
  complete. Do not soften "does not carry" into "limited support".
- Keep two counts separate every time: 90 catalogued query ids versus 93 served
  statement ids after lettering (Q14, Q23, Q24 split in two). Never write "93 of
  99".
- Keep audit figures (post 20) and OBT rerun figures (three local replaced, three
  cloud flagged) in separate sentences. Do not derive one from the other.
- Describe the old converter by what it did, not by the people who wrote it.
  No em-dashes or en-dashes anywhere; hyphen only.
- Do not name internal gates, waiver files, workflow names or the corpus validator.
  `make tpcds-obt-equivalence` is the one command worth naming.
- No performance numbers beyond the 5,041,336-row load size and run counts above;
  this post is about correctness. If load times appear, state engine and
  environment, and do not set them side by side.
- Verified in this outline pass (2026-11-07, BenchBox `develop` at `fbb2278152`):
  90 catalogued entries and exclusion ids `[8, 21, 22, 37, 39, 54, 72, 82, 84]`
  via `load_catalog()` and `load_exclusions()`; `get_obt_columns("full")` is 715
  and `"minimal"` is 424; PR merge dates via `gh pr view`; old converter had 89
  convertible ids and blocked 10 (from `query_specs.yaml` at `2dd7f7cbdc^`).
- Verify before drafting:
  - Who noticed the parameter defect and how (not recorded in the repos). Ask.
  - Whether the old converter's 89 served ids were ever published as "90"; the
    pre-0.2 docs claim should be read from `git show 2dd7f7cbdc^:docs/...` or the
    site repo history of `docs/benchmarks/tpc-ds-obt.md` (not read here).
  - `docs/benchmarks/tpc-ds-obt.md:57-70` "Column Groups" table uses `ss_`, `c_`,
    `ca_` prefixes and approximate counts that predate `model.yaml`; do not quote
    it. Use the lineage page and `model.yaml` instead, and flag the stale table to
    the docs owner.
  - Platform support table (`tpc-ds-obt.md:206-214`) against what v0.5.0 actually
    runs; only `questdb.py` and `velox.py` mention OBT in `benchbox/platforms/`
    (grep), so support is mostly generic. Quote only platforms with bundles
    (BigQuery, ClickHouse Local, Databricks, DataFusion, DuckDB, Snowflake).
  - Whether the DataFrame path (`dataframe_queries.py`, `obt_*` ids per PR #3381)
    belongs in this post. It is separate from the SQL catalog; default to one
    sentence or leave out.
  - `lineage.py` line for the "channel with no source writes NULL" statement.
  - Experimental status at v0.5.0 (`CHANGELOG.md:972` is an old release entry).
  - Corpus counts, since local reruns continue (`CORPUS_NOTES.md:1462-1472`,
    `:1623-1626`).
  - Merge/ship state of PR #3788 and that 6 GB figure before quoting it.
  - That `make tpcds-obt-equivalence` still passes at SF0.01 and SF1 on the release
    commit; the outline cites the recorded expected lists, not a fresh run.
- Series plan row to be added by the main agent (status OUTLINED); see below.

## Series plan row

Proposed row for the table in `drafts/building-benchbox/outlines/series-plan.md`
(after row 21, same format as rows 20 and 21; link target is the outline until a
draft exists):

```
| 22  | TPC-DS OBT rebuilt: from a query converter to a catalog we own | [Outline](22-tpcds-obt-rebuilt.md) | The one-big-table TPC-DS variant now runs 90 of 99 queries from a hand-owned catalog pinned to the TPC-DS templates and checked against TPC-DS answers; the nine it cannot serve each record a reason, and pre-0.2 OBT results are flagged or rerun |
```
