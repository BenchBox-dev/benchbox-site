---
tags: [reference]
---

# Real-World Data Benchmarks

Benchmarks built on public real-world datasets rather than synthetic TPC or vendor data.

## Why Real-World Data?

Synthetic benchmarks like TPC-H generate data that is statistically clean: uniform distributions, predictable cardinalities, well-behaved joins. Real-world data is messier - skewed, sparse, seasonal, and full of edge cases. BenchBox's real-world benchmarks capture these characteristics using authoritative public datasets.

**What real-world data exposes that synthetic data hides:**

- **Temporal skew** - weekday vs. weekend, rush hour vs. overnight, holiday effects
- **Geographic skew** - airport hubs, city centers, regional carriers
- **Categorical imbalance** - a handful of carriers / zones / host classes dominate
- **Sparsity** - not every combination of dimensions exists in the data
- **Dirty data** - nulls, rare categories, outliers that force defensive SQL

These characteristics drive optimizer behavior in ways TPC workloads do not - cardinality estimation, join ordering, partition pruning, and predicate pushdown all behave differently.

## Real-World Benchmarks in BenchBox

| Benchmark | Data Source | Focus |
| --- | --- | --- |
| **NYC Taxi** | NYC TLC trip records | Geospatial + temporal OLAP, taxi zones dimension, 25 queries |
| **Flight Data** | US BTS On-Time Performance | Aviation analytics - delays, routes, carriers, seasonality, 20 queries |

## When to Use

- **NYC Taxi** - geospatial joins, pickup/dropoff zone rollups, fare analytics
- **Flight Data** - test temporal and categorical aggregation on a 20+ year government dataset

## Included Benchmarks

- [NYC Taxi OLAP Example Dataset](nyctaxi.md)
- [Flight Data Benchmark](flightdata.md)

## See Also

- [Time-Series Benchmarks](time-series-benchmarks.md) - Time-series workloads (TSBS DevOps)
- [Industry Benchmarks](industry-benchmarks.md) - Vendor / practitioner benchmarks (ClickBench, H2O, CoffeeShop)
- [TPC Standards](tpc-standards.md) - Synthetic standard benchmarks
