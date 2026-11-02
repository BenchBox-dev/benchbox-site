---
title: BenchBox Primitives
tags:
  - reference
  - custom-benchmark
sourcePath: docs/benchmarks/benchbox-primitives.md
titleId: benchbox-primitives
headingIds:
  - why-primitives
  - design-philosophy
  - use-cases-for-primitives
  - primitive-categories
  - dataframe-support
  - included-benchmarks
  - see-also
---

<span id="benchbox-primitives"></span>

Fundamental database operation testing designed for deep performance investigation.

## Why Primitives?

Standard benchmarks like TPC-H measure end-to-end query performance, but when a query runs slowly, they don't tell you *why*. Is it the join algorithm? Predicate pushdown? Aggregation strategy? Data loading? Primitive benchmarks isolate individual operations to answer these questions.

BenchBox Primitives were created to fill a gap in the benchmarking landscape:

- **TPC benchmarks** test complete queries but hide which operations are slow
- **Microbenchmarks** test operations but lack realistic data characteristics
- **Primitives** combine isolated operations with benchmark-scale data

This approach enables systematic performance investigation that pinpoints bottlenecks.

## Design Philosophy

BenchBox Primitives follow several design principles:

**Isolation**: Each primitive tests one operation or a small family of related operations. A filter primitive tests filtering, not filtering-then-joining. This isolation makes performance differences attributable to specific capabilities.

**Realistic data**: Primitives use TPC-derived data with realistic distributions, cardinalities, and correlations. Testing a filter on uniformly distributed random data tells you little about production performance.

**Coverage**: The primitives cover the fundamental operations that compose all analytical queries: scans, filters, projections, aggregations, joins, sorts, and more. Understanding primitive performance predicts complex query performance.

**Platform agnostic**: Primitives work across SQL and DataFrame platforms, enabling comparison between Pandas and PostgreSQL, or Polars and DuckDB. The same logical operation is tested regardless of API.

## Use Cases for Primitives

**Performance debugging**: When a TPC-H query runs slower than expected, run the corresponding primitives to identify which operation is the bottleneck. Is Q9's slowdown from the join strategy or the aggregation?

**Platform evaluation**: Before choosing a database, test the operations your workload uses most. If your queries are join-heavy, the join primitives predict real performance better than aggregate TPC scores.

**Optimization validation**: After tuning a database, run primitives to verify the optimization worked. Did the new index actually speed up the filter operation? Primitives provide focused measurement.

**Regression detection**: Track primitive performance across database versions to catch regressions early. A 20% slowdown in aggregation primitives predicts problems before they appear in complex queries.

**DataFrame vs SQL comparison**: Primitives enable apples-to-apples comparison between DataFrame libraries (Polars, Pandas) and SQL databases (DuckDB, PostgreSQL) on the same logical operations.

## Primitive Categories

BenchBox Primitives are organized into three categories:

| Category                   | Operations                                                                | Insights                                                                  |
| -------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Read Primitives**        | Scans, filters, projections, aggregations, joins, sorts, window functions | Query execution performance, optimizer effectiveness                      |
| **Write Primitives**       | Inserts, bulk loads, updates, deletes, upserts                            | Data loading performance, transaction overhead                            |
| **Transaction Primitives** | Isolation levels, concurrent access, conflict resolution                  | ACID compliance, concurrency characteristics                              |
| **Metadata Primitives**    | INFORMATION_SCHEMA, SHOW, DESCRIBE, PRAGMA catalog queries                | Catalog introspection performance for data catalogs, BI tools, governance |
| **AI Primitives**          | SQL-based AI functions - generation, summarization, sentiment, embeddings | Cloud AI SQL surface (Snowflake Cortex, BigQuery ML, Databricks AI)       |

### DataFrame Support

Read and Write Primitives include full DataFrame implementations supporting both expression-based platforms (Polars, PySpark, DataFusion) and pandas-compatible platforms (Pandas, Dask, cuDF). This enables direct comparison between SQL and DataFrame performance on identical operations.

## Included Benchmarks

- [Read Primitives Benchmark](/docs/benchmarks/read-primitives.html)
- [Write Primitives Benchmark](/docs/benchmarks/write-primitives.html)
- [Transaction Primitives Benchmark](/docs/benchmarks/transaction-primitives.html)
- [Metadata Primitives Benchmark](/docs/benchmarks/metadata-primitives.html)
- [AI/ML Primitives Benchmark](/docs/benchmarks/ai-primitives.html)

## See Also

- [Understanding Benchmark Results](/docs/tutorials/understanding-results.html) - Interpreting benchmark output
- [Platform Comparison Guide](/docs/guides/platform-comparison.html) - Comparing platforms systematically
- [TPC Standards](/docs/benchmarks/tpc-standards.html) - End-to-end query benchmarks
