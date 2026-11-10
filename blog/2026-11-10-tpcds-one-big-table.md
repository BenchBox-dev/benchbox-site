---
blogpost: true
date: November 10, 2026
author: Joe Harris
series: building-benchbox
post_number: 22
type: architecture-design
tags: benchbox, tpc-ds, tpcds-obt, one-big-table, benchmark-design, query-templates, dsqgen, correctness
meta_description: "TPC-DS OBT runs the TPC-DS queries on one 715-column table to test denormalized data models. In v0.5.0 its 90 query templates are checked against TPC-DS."
---

# TPC-DS One-Big-Table: a more demanding test of denormalized data modelling

> TPC-DS OBT runs the TPC-DS queries against one wide table, and every query has a normalized twin with the same answer. One engine can then show what a flat design costs or saves.

**TL;DR**: Denormalized wide tables are a common data model for analytics. TPC-DS OBT is a new benchmark created for BenchBox to test this data model. Modified TPC-DS queries are run against a single 715-column table. Our first attempt did not match the results in many cases but, in v0.5.0, the queries became tested templates. Each template is checked against the TPC-DS answer; 90 of the 99 queries are compatible with our TPC-DS OBT conversion.

---

![A grid of the 99 TPC-DS queries coloured by status in TPC-DS OBT: 87 proven equal to TPC-DS on real rows, 3 compatible but not yet provable at scale factor 1 (Q23, Q24, Q61), 6 incompatible because they read the inventory fact table, and 3 incompatible because they need customers or stores with no sales (Q8, Q54, Q84).](./images/tpcds_obt_query_compatibility.png)

## One big table with a normalized twin

Wide, flat tables are common in warehouses and lakehouses, but few benchmarks measure them. TPC-DS OBT (one big table) is our answer. We flatten the TPC-DS schema into a single table and convert the TPC-DS queries to run against it. The idea is to benchmark how effective data platforms are at column pruning, wide-table scans, and result materialization, especially for lakehouse storage formats like Parquet, Delta and Iceberg. TPC-DS OBT has been in BenchBox since the first release and is still marked experimental[^obt-doc].

The usual single-table benchmark is ClickBench[^clickbench]. It is easy to run and widely reported, and its own documentation is plain about its limits. It is one table of web analytics data with about 100 columns. Its 43 queries were improvised for the benchmark, and none of them joins anything. Most of all, there is no normalized version of the same data. ClickBench can tell you how fast an engine scans that one table. It cannot tell you whether flattening your own schema would help.

TPC-DS OBT is built to answer that second question. Every compatible query has a twin in TPC-DS that returns the same answer from the normalized schema, on the same generated data. Run both on one engine and the difference in time is what the flat design costs or saves, because the question and the answer are the same.

It is also a harder test of a wide table. Whole groups of its columns are `NULL` on any row, because a store sale has no web page and no call center. The queries are the TPC-DS ones, with their subqueries, window functions and rollups. Earlier star schema against one-big-table comparisons used a small slice of TPC-DS: one 2022 test joined five tables and ran ten queries[^star-vs-obt]. TPC-DS OBT covers all three sales channels and 90 of the 99 queries.

The wide table we generate has one row per sale line across the store, web and catalog channels. The matching return, if any, is joined onto the sale by ticket or order number and item. A `channel` column says which channel the row came from, and columns that channel does not have are `NULL`. Dimension columns carry role prefixes such as `sold_date_`, `item_` and `store_`. The [column lineage page](https://benchbox.dev/docs/benchmarks/tpc-ds-obt-lineage.html) traces every one of its 715 columns back to its TPC-DS source.

We built on TPC-DS instead of designing a new workload because TPC-DS already provides the hardest parts to build. It has realistic datasets we can generate consistently at any scale, and well-understood queries with known answers we can check. The only thing we had to invent was the "flattening" logic (denormalization).

## What we learned from our first take

We wrote the first version of TPC-DS OBT as a converter: about 1,600 lines that parsed each TPC-DS template with SQLGlot at startup and rewrote it onto the big table. By the end it converted 89 queries and could not convert 10. For a first version that was a reasonable way to get 89 queries running on a new schema, and we published results from it on six platforms.

What it lacked was any way to tell us when it was wrong. The SQL was regenerated in memory on every run, so nothing in the repository recorded what a query was supposed to be. We also had no test that compared an answer with TPC-DS. A change to the converter, to SQLGlot, or to a template could change the benchmark without a diff anyone would review. We built a benchmark whose one external check, matching TPC-DS, we were not running.

When we ran that check in October 2026, we found three kinds of mismatch.

**We never used the TPC-DS parameters.** TPC-DS queries are templates, and dsqgen fills their parameters from a seed. Our converter filled them itself, often with `0` or the first value in a list. Q93 therefore filtered on `reason_r_reason_desc = '0'`, and it and many other queries returned no rows[^pr3062].

![TPC-DS OBT Q93 on one DuckDB database at scale factor 1. BenchBox 0.4.2 generates the filter reason_r_reason_desc = '0', which matches 0 sale lines and returns 0 rows. BenchBox 0.5.0 generates reason_r_reason_desc = 'Did not like the warranty', the value dsqgen draws, which matches 3,609 sale lines and returns 100 rows. The table holds 75 return reasons and none is '0'. Neither query raises an error.](./images/tpcds_obt_q93_parameters.png)

**Some of our joins could not return rows.** Several queries joined through the wrong date columns, or compared columns that can never be equal on a flat table, so they matched nothing[^pr3120].

**Some of our answers differed from TPC-DS.** Once parameters and joins were right, we could compare answers for the first time, and we rewrote 37 queries by hand. Three the converter could not handle (Q46, Q64 and Q68) turned out to be compatible. Two we had been running (Q8 and Q54) cannot be expressed on the table at all and are now recorded as incompatible. Q2 had built its calendar from sales rows, so it matched TPC-DS only at some scale factors; it now uses the week and year boundaries of the TPC-DS date table[^pr3380].

All six TPC-DS OBT results we had published ran with the wrong parameters. They were at scale factor 1 (SF 1), on BigQuery, ClickHouse Local, Databricks, DataFusion, DuckDB and Snowflake. Each now carries the marker `defective-tpcds-obt-parameters`, which removes it from rankings and keeps it available for comparison[^corpus-defect]. A query that returns no rows finishes fast, and a run full of such queries looks like a fast engine; nothing in a timing tells you the question was wrong. Only an answer check does, and we had not written one.

## Query templates beat query conversions

We replaced the converter with query templates[^pr3353]. Each compatible query now has its own template, as in TPC-DS: the SQL for that query, with named placeholders. dsqgen fills them with its draw, the parameter values it picks for a seed. We had two reasons:

- **The SQL is data in a file.** A reviewer reads a diff of one query. With a converter, the reviewer reads a diff of a rewriting engine and has to imagine what it does to the other 89 queries.
- **The hard queries were already hand-written**, and in v0.5.0 we hand-wrote 37 more. A converter that is mostly special cases is a set of templates with extra steps.

A query template is short. The header of the Q1 template:

```yaml
- id: 1
  template: query1.tpl
  template_sha256: 43bd12704315f45866976de974e809c5371734d8dfe2a04f3ba0c1384350ecf7
  parameters:
    AGG_FIELD: [1]
    COUNTY: []
    STATE: [1]
    YEAR: [1]
  identifier_parameters: [AGG_FIELD]
  identifier_map:
    sr_return_amt: return_amount
    sr_return_amt_inc_tax: return_amount_inc_tax
  sql: |
    ...
```

The hash pins the TPC-DS template this one derives from. `parameters` lists the dsqgen parameters the SQL uses. `identifier_map` maps the column names dsqgen can draw onto the big table's names. The SQL keeps the `[NAME]` placeholders exactly as TPC-DS writes them.

The cost is plain: 90 query templates are 90 things we have to keep right ourselves, so each one is tested against TPC-DS.

## Which queries are compatible, and why nine are not

90 of the 99 TPC-DS queries are compatible with one big table, and each has a query template. A test requires every id from 1 to 99 to either have a template or be on the incompatible list with a reason. Asking for an incompatible query raises `QuerySkippedError` with that reason. Nothing else runs under the number.

| Queries | Recorded reason |
|---|---|
| Q21, Q22, Q37, Q39, Q72, Q82 | Reads the inventory fact table, a separate fact domain the OBT does not carry. |
| Q8 | Needs customer zip codes and stores that have no sales rows; the OBT only carries dimension rows reachable from a sale line. |
| Q54 | Needs customers and stores that have no sales rows; the county and state match runs over every customer and store. |
| Q84 | Needs customers that have no sales rows; the query joins customers to store returns through the customer's current address and income band. |

Making the nine compatible would change what "one big table" means: the inventory six need a second fact table, and the other three need dimension rows that no sale touches. We would rather run 90 honest queries than 99 where some quietly answer a different question.

One counting detail. Q14, Q23 and Q24 each have two statements in TPC-DS, and TPC-DS OBT runs them as `14a`/`14b`, `23a`/`23b` and `24a`/`24b` to match. So a run reports 93 statement ids from 90 query templates.

## How we check that the answers match

Four checks, in the order they would fail.

**Parameters come from dsqgen.** When a query is requested, BenchBox runs dsqgen's parameter log for that query id, seed, scale factor and stream, and renders the logged values into the query template. A TPC-DS OBT run at seed 42 asks the same question TPC-DS asks at seed 42.

**The source template is pinned.** `template_sha256` must match the TPC-DS template BenchBox ships. If the TPC-DS template changes, a test fails and tells you to re-derive ours.

**Placeholders and parameters agree.** Every placeholder in the SQL must be declared. Every declared parameter must exist in the TPC-DS template. Every column dsqgen can draw must have an entry in `identifier_map`.

**Answers match.** Two tests compare answers. An integration test builds both schemas on DuckDB from the same generated data and compares each compatible query with TPC-DS, at SF 0.01 and again at SF 1. A nightly job does the same at SF 0.01 on four engines: SQLite, DuckDB, DataFusion and PostgreSQL. It runs all 93 statements and compares each with the matching TPC-DS statement on the same engine[^pr3504]. Neither test lists a query whose answer differs.

Both tests share one limit: two empty results are equal, and that proves nothing. At SF 0.01 the TPC-DS query itself often returns no rows or only zeros, so 19 queries cannot be verified on DuckDB and 29 of 93 statements cannot in the four-engine job. At SF 1 only three remain (Q23, Q24 and Q61); the other 87 are proven equal on real rows. The [SQLGlot fork post](./2026-11-07-why-benchbox-ships-its-own-sqlglot-fork.md) describes the same lesson.

## What this means for published TPC-DS OBT results

v0.5.0 widened the table and changed which queries run, so a TPC-DS OBT result from an earlier release cannot be compared with one from v0.5.0 or later.

Three local SF 1 results have been rerun on the new query templates. DuckDB ran 93 statement ids and 279 measured executions with no failures, after loading 5,041,336 rows. DataFusion ran the same 93 ids with no failures. ClickHouse Local (chDB 4.1.6) ran 93 ids, with Q41 and Q44 failing on that engine. Every id returns the same row count on DuckDB and DataFusion, and on ClickHouse for every id except those two[^corpus-rerun]. Three cloud results (BigQuery, Snowflake and Databricks) stay flagged until a rerun is approved.

Seven ids return no rows at SF 1 with the default draw: Q23b, Q24a, Q24b, Q25, Q29, Q41 and Q58. Plain TPC-DS returns no rows for the same ids on the same DuckDB database, so an empty result there is the TPC-DS answer.

## DataFrame engines do not run the TPC-DS queries yet

**What exists today.** TPC-DS OBT runs on the DataFrame platforms (Polars, Pandas and DataFusion) against the same 715-column table, loaded from Parquet. They run 17 queries of their own, with names such as `obt_row_count` and `obt_channel_revenue`[^obt-doc].

**How that differs from SQL.** The 17 are simple filters, group-bys and totals over the one table. None of them is a TPC-DS query, so none has a TPC-DS answer to match. They have no query templates, no dsqgen parameters and no answer check; our tests confirm only that the two implementations of each query agree with each other. A DataFrame result shows how fast an engine handles a wide table. It has no normalized twin, and it cannot be compared with a SQL result.

**What we commit to.** DataFrame engines will get the same treatment as SQL. We will write the TPC-DS queries for the DataFrame APIs, draw their parameters with dsqgen and check the answers against TPC-DS. Any query that cannot be expressed will be recorded as incompatible. Until then the 17 are labelled by name and never by a TPC-DS query number, so one cannot be mistaken for the other.

## Limitations

Full answers are compared on four local engines at SF 0.01 and on DuckDB alone at SF 1. ClickHouse Local and the cloud engines are not answer-checked; the ClickHouse Local rerun is checked by row count against DuckDB.

ClickHouse Local fails Q41 and Q44 because ClickHouse 26.1, the engine inside chDB 4.1.6, raises `NOT_IMPLEMENTED` for a correlated subquery over a `DISTINCT` subquery. The failure reproduces outside BenchBox.

We maintain the query templates by hand. A change to a TPC-DS template fails a test, but the rewritten SQL is only as right as its reviewer and the answer check.

In v0.5.0, `benchbox run` accepts only scale factor 1 for TPC-DS OBT and rejects every other scale factor. That is a bug, and v0.5.1 will correct it.

## What to do next

Upgrade to v0.5.0 and rerun any TPC-DS OBT workload.

Run `benchbox run --platform duckdb --benchmark tpcds_obt --scale 1` and check that queries such as Q93 return rows. Expect `QuerySkippedError` for the nine incompatible queries; the message carries the reason.

If a TPC-DS OBT query's answer differs from TPC-DS, report it with the query id, scale factor and platform. That is the one claim TPC-DS OBT makes, and the one worth checking.

---

## References

- Benchmark page: [TPC-DS OBT](https://benchbox.dev/docs/benchmarks/tpc-ds-obt.html); [column lineage](https://benchbox.dev/docs/benchmarks/tpc-ds-obt-lineage.html).
- Code in [BenchBox-dev/BenchBox](https://github.com/BenchBox-dev/BenchBox): `benchbox/core/tpcds_obt/catalog/queries.yaml` (the query templates and the incompatible list), `catalog/loader.py`, `queries.py`, `model.yaml`; tests `tests/unit/core/tpcds_obt/test_tpcds_obt_catalog.py` and `tests/integration/test_tpcds_obt_equivalence.py`.
- Companion posts: [Why BenchBox ships its own SQLGlot fork](./2026-11-07-why-benchbox-ships-its-own-sqlglot-fork.md); [BenchBox v0.5.0](./2026-11-06-v0-5-0-release-overview.md).
- Q93 evidence behind the second image: `drafts/building-benchbox/research/tpcds-obt-q93-parameters-2026-11-09.md` in the site repository.

[^obt-doc]: [TPC-DS OBT benchmark page](https://benchbox.dev/docs/benchmarks/tpc-ds-obt.html), sections "Overview", "Use Cases" and "DataFrame Query IDs".
[^clickbench]: [ClickBench README](https://github.com/ClickHouse/ClickBench#limitations), sections "Overview" and "Limitations" - ClickHouse, accessed November 9, 2026.
[^star-vs-obt]: [Data warehouse modeling: Star schema vs. OBT](https://www.fivetran.com/blog/star-schema-vs-obt) - Michael Kaminsky, Fivetran, August 16, 2022.
[^pr3062]: [BenchBox PR #3062](https://github.com/BenchBox-dev/BenchBox/pull/3062), render query parameters from the dsqgen draw, merged October 17, 2026.
[^pr3120]: [BenchBox PR #3120](https://github.com/BenchBox-dev/BenchBox/pull/3120), fix TPC-DS OBT conversions that could not return rows, merged October 18, 2026.
[^pr3353]: [BenchBox PR #3353](https://github.com/BenchBox-dev/BenchBox/pull/3353), replace the TPC-DS OBT converter with stored query templates, merged October 23, 2026.
[^pr3380]: [BenchBox PR #3380](https://github.com/BenchBox-dev/BenchBox/pull/3380), make the TPC-DS OBT queries return the TPC-DS results and record Q8, Q54 and Q84 as incompatible, merged October 24, 2026.
[^pr3504]: [BenchBox PR #3504](https://github.com/BenchBox-dev/BenchBox/pull/3504), execute TPC-Havoc and TPC-DS OBT on every gate engine, merged October 26, 2026.
[^corpus-defect]: [`results-data/CORPUS_NOTES.md`](https://github.com/BenchBox-dev/BenchBox/blob/31f6d755b5cd1f08dbf288a4507f4eb5f60b2e9c/results-data/CORPUS_NOTES.md) in the BenchBox repository, section "TPC-DS OBT parameter defect (2026-10-16)".
[^corpus-rerun]: [`results-data/CORPUS_NOTES.md`](https://github.com/BenchBox-dev/BenchBox/blob/31f6d755b5cd1f08dbf288a4507f4eb5f60b2e9c/results-data/CORPUS_NOTES.md), section "TPC-DS OBT SF1 reruns on the lettered catalog (2026-10-26)"; reruns merged in [PR #3550](https://github.com/BenchBox-dev/BenchBox/pull/3550).

*Questions or feedback? [Open an issue](https://github.com/BenchBox-dev/BenchBox/issues) or join the discussion.*
