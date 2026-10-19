# Publication Schedule

> The BenchBox blog publication queue: one row per unpublished
> actionable article.
> **Last updated:** 2026-10-19

## How this queue works

- Each row links the one real source file for the article. There is
  one maintained copy: draft in `drafts/`, moved to `blog/` on its
  publication branch (see `PUBLISHING.md`).
- **Owner:** Joe owns priority, merge, and release. The author owns
  preparation. No owner commitments beyond that are recorded here.
- **Priority:** Joe sets it. No readiness is claimed: the next action
  is the work still owed, not a readiness verdict.
- A publication branch may carry a candidate in `blog/` while it
  awaits review. `blog/` on `main` is release-authorized.
- Published history lives in the site archive (`blog/` index,
  archive, tag and author pages, Atom feed), not in this file.
- Outlines and ideas worth keeping are listed under Backlog, not in
  the queue.

---

## Upcoming queue

| Article | Source | Priority | Owner | Next action | Blockers / notes |
| ------- | ------ | -------- | ----- | ----------- | ---------------- |
| BenchBox in action: when the same query needs different code | [Draft](benchbox-in-action/drafts/06-platform-specific-optimization-patterns.md) | High | Joe / author | Human editorial check and review | - |
| How the Results Explorer qualifies comparisons | [Draft](building-benchbox/drafts/17-results-explorer-qualifies-comparisons.md) | Medium | Joe / author | Resolve hold with Joe, then editorial check | Publication withheld |
| BenchBox v0.4.1: more lakehouse pairings, stricter results | [Draft](building-benchbox/drafts/18-v0-4-1-release-overview.md) | Medium | Joe / author | Human editorial check and review | Verify lakehouse pairing count against the draft before publish |
| Free trials intro: a benchmarker's guide | [Draft](free-trial-benchmarking/drafts/00-series-intro.md) | Medium | Joe / author | Human editorial check and review | Time-sensitive: trial terms change; verify before publish |
| Free trial benchmarking: Snowflake | [Draft](free-trial-benchmarking/drafts/01-snowflake.md) | Medium | Joe / author | Human editorial check and review | Time-sensitive: trial terms change; verify before publish |
| Free trial benchmarking: Databricks | [Draft](free-trial-benchmarking/drafts/02-databricks.md) | Medium | Joe / author | Human editorial check and review | Time-sensitive: trial terms change; verify before publish |
| Free trial benchmarking: BigQuery | [Draft](free-trial-benchmarking/drafts/03-bigquery.md) | Medium | Joe / author | Human editorial check and review | Time-sensitive: trial terms change; verify before publish |
| Free trial benchmarking: MotherDuck | [Draft](free-trial-benchmarking/drafts/04-motherduck.md) | Medium | Joe / author | Human editorial check and review | Time-sensitive: trial terms change; verify before publish |
| Free trial benchmarking: Redshift Serverless | [Draft](free-trial-benchmarking/drafts/05-redshift-serverless.md) | Medium | Joe / author | Human editorial check and review | Time-sensitive: trial terms change; verify before publish |
| Free trial benchmarking: Starburst Galaxy | [Draft](free-trial-benchmarking/drafts/06-starburst-galaxy.md) | Medium | Joe / author | Human editorial check and review | Time-sensitive: trial terms change; verify before publish |
| Free trial benchmarking: ClickHouse Cloud | [Draft](free-trial-benchmarking/drafts/07-clickhouse-cloud.md) | Medium | Joe / author | Human editorial check and review | Time-sensitive: trial terms change; verify before publish |
| Free trial benchmarking: Microsoft Fabric | [Draft](free-trial-benchmarking/drafts/08-microsoft-fabric.md) | Medium | Joe / author | Human editorial check and review | Time-sensitive: trial terms change; verify before publish |
| Free trial benchmarking: Firebolt | [Draft](free-trial-benchmarking/drafts/09-firebolt.md) | Medium | Joe / author | Human editorial check and review | Time-sensitive: trial terms change; verify before publish |
| Free trial benchmarking: Athena | [Draft](free-trial-benchmarking/drafts/10-athena.md) | Medium | Joe / author | Human editorial check and review | Time-sensitive: trial terms change; verify before publish |
| Cloud cost controls series intro | [Draft](cloud-cost-controls/drafts/00-series-intro.md) | Medium | Joe / author | Human editorial check and review | - |
| AWS cost controls for analytics benchmarks | [Draft](cloud-cost-controls/drafts/01-aws-cost-controls-analytics-benchmarks.md) | Medium | Joe / author | Human editorial check and review | - |
| GCP cost controls for BigQuery benchmarking | [Draft](cloud-cost-controls/drafts/02-gcp-bigquery-cost-controls.md) | Medium | Joe / author | Human editorial check and review | - |
| Snowflake credit controls for testing | [Draft](cloud-cost-controls/drafts/03-snowflake-credit-controls.md) | Medium | Joe / author | Human editorial check and review | - |
| Databricks cost controls for benchmarking | [Draft](cloud-cost-controls/drafts/04-databricks-cost-controls.md) | Medium | Joe / author | Human editorial check and review | - |
| Azure Synapse and Fabric cost controls | [Draft](cloud-cost-controls/drafts/05-azure-synapse-fabric-cost-controls.md) | Medium | Joe / author | Human editorial check and review | - |
| The AWS Free Tier trap | [Draft](cloud-cost-controls/drafts/06-aws-free-tier-trap.md) | Medium | Joe / author | Human editorial check and review | - |
| Table formats for benchmarking: what we learned | [Draft](table-formats/drafts/00-table-formats-what-we-learned.md) | Low | Joe / author | Human editorial check and review; set publication date | Cloud benchmarks for Delta/Iceberg pending (see Backlog) |
| Parquet basics | [Draft](table-formats/drafts/01-parquet-basics.md) | Low | Joe / author | Human editorial check and review; set publication date | - |
| What we built on top of SQLGlot | [Draft](building-benchbox/drafts/11-what-we-built-on-top-of-sqlglot.md) | Unset (Joe) | Joe / author | Human editorial check and review | - |
| SCD Type 2: declarative CDC vs portable SQL MERGE | [Draft](platform-deep-dives/drafts/apply-changes-into-vs-standard-sql.md) | Unset (Joe) | Joe / author | Human editorial check and review | Evidence lives in `drafts/platform-deep-dives/research/`; verify claims against it |
| DuckDB architecture claim notes | [Claim notes](platform-deep-dives/drafts/duckdb-architecture.md) | Unset (Joe) | Joe / author | Shape into a post draft or attach to its post; human editorial check | Supporting note, not a post draft; corrects an "under 10 seconds" TPC-H SF10 claim with measured M4 wall times; evidence in [verification notes](platform-deep-dives/research/duckdb-architecture-verification-2026-02-20.md) |

---

## Backlog (outlines and ideas worth keeping)

Outlines only; no draft exists yet. Kept for their planning value,
not queued for publication.

| Idea | Source | Notes |
| ---- | ------ | ----- |
| Delta Lake with BenchBox | [Outline](table-formats/outlines/02-delta-lake.md) | Local SF1 storage measured (305 MB); Databricks/Spark cloud benchmarks pending |
| Apache Iceberg with BenchBox | [Outline](table-formats/outlines/03-iceberg.md) | Local SF1 measured via pyiceberg SQLite catalog; cross-engine comparisons need a shared catalog |
| Vortex with BenchBox | [Outline](table-formats/outlines/04-vortex.md) | Local SF1 measured (274 MB) via DuckDB vortex extension |
| Vector search across six engines | [Outline](benchbox-in-action/outlines/02-vector-search-recall-latency.md) | Outlined; needs drafting |
| Rewriting TPC-DS Q10 and Q35 for ClickHouse | [Outline](platform-deep-dives/outlines/clickhouse-tpcds-q10-q35-semijoin-rewrites.md) | Plan only; do not draft until the listed experiments run |
| Spark Adaptive Query Execution | [Outline](platform-deep-dives/outlines/spark-adaptive-query-execution.md) | Outlined; BenchBox measurements are future work |
| TPC binary wrangling (building-benchbox idea) | Series plan idea, no file | Cross-platform binary distribution for TPC data generation |
| DataFrame benchmarking: SQL to Polars/Pandas (building-benchbox idea) | Series plan idea, no file | Faithful TPC-H translation challenges |
| Cost controls posts 7-9 ideas (Budget Actions, tool comparison, multi-cloud synthesis) | Series plan ideas, no files | Follow-ups once posts 1-6 publish |
| BenchBox in action ideas (scale-factor rankings, cloud vs embedded cost, tuned vs untuned, DataFrame translation) | Series plan ideas, no files | Methodology findings, drafted as results land |

---

## Notes

- Previously published posts are not listed here; the site archive
  is the record.
- Trial-credit figures, cloud pricing, and platform trial terms go
  stale fast. Every time-sensitive row must be re-verified against
  current vendor terms during its editorial check.
