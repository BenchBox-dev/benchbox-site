---
tags: [advanced, reference, ai-ml]
---

# AI & ML Benchmarks

Benchmarks for AI / ML workloads that modern cloud databases increasingly handle natively - currently vector similarity search, with SQL-based AI functions covered under Primitives.

## Why AI/ML Benchmarks?

Analytical databases are absorbing workloads that used to require dedicated ML infrastructure. **Vector similarity search** - kNN / ANN over embedding vectors - is the most mature case: DuckDB, PostgreSQL (pgvector), ClickHouse, Snowflake, StarRocks, and Doris all ship array / vector types with distance functions.

Vector workloads differ from OLAP:

- **High-dimensional distance computations** dominate CPU cost
- **Recall vs. latency trade-offs** depend on ANN index choice (HNSW, IVF)
- **Data shapes are different** - fixed-length arrays and large row counts

BenchBox ships repeatable vector-search queries with synthetic embeddings so you can compare engines without depending on an external embedding service.

## AI/ML Benchmarks in BenchBox

| Benchmark | Focus | Target Platforms |
| --- | --- | --- |
| **Vector Search** | kNN / ANN similarity search over embedding vectors | DuckDB, pgvector, ClickHouse, Snowflake, StarRocks, Doris |

Synthetic embeddings are generated locally with a fixed seed, so there is no per-query API cost regardless of scale.

## Included Benchmarks

- [Vector Search Benchmark](vector-search.md)

> [!NOTE]
> **AI Primitives** - SQL-based AI functions (Snowflake Cortex, BigQuery ML,
> Databricks AI) - is a related but distinct workload registered under
> ``Primitives`` in the benchmark registry. See
> [BenchBox Primitives](benchbox-primitives.md) for coverage.

## See Also

- [BenchBox Primitives](benchbox-primitives.md) - Core SQL operation primitives (includes AI Primitives)
- [BenchBox Experimental](benchbox-experimental.md) - Other emerging benchmarks
