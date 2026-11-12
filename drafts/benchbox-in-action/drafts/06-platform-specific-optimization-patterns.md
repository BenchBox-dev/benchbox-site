---
blogpost: true
date: November 18, 2026
author: Joe Harris
series: benchbox-in-action
type: technical-challenge
tags: benchmarking, benchbox, polars, duckdb, datafusion, pyspark, tpc-ds, dataframe, query-optimization
meta_description: "In February two DataFrame patterns had opposite winners on Polars and DataFusion. Rerun on current releases and TPC-DS data, a third pattern is fastest on all four engines."
---

# BenchBox in action: when the same query needs different code

> In February, two ways of writing one TPC-DS step had opposite winners on Polars and DataFusion, and we added a platform branch to BenchBox. We reran the test in November on old and new engine releases. The February result reproduces, but only on the data shape and versions we tested then.

**TL;DR**: Finding orders shipped from more than one warehouse can be written as a self-join or as a distinct count. In February the self-join was 2-5x faster on DataFusion 51 and the distinct count 2-4x faster on Polars 1.37, so BenchBox picks the pattern by platform. Rerun on an Apple M4 in November, the split reproduces on those versions with our synthetic data. On TPC-DS data it reverses for DataFusion 51, and on DataFusion 55 the distinct count is faster on every dataset. A third pattern, comparing the minimum and maximum warehouse per order, was the fastest in 39 of 40 tests on the current releases of Polars, DuckDB, DataFusion and PySpark.

---

## Introduction

BenchBox runs each benchmark query as SQL and, on DataFrame platforms, as DataFrame code written once against a common interface. In February 2026 we found a step in two TPC-DS queries where one way of writing that code was several times faster on Polars and another was several times faster on DataFusion. We measured it, read the query plans, and added a branch that picks the pattern by platform.

That was nine months ago. Since then Polars 2.0 made its streaming engine the default for lazy queries[^polars2], DuckDB shipped 2.0.0[^duckdb2], DataFusion moved from 51 to 55 and PySpark from 4.1 to 4.3. Before publishing the finding we reran it, and we added three things the February test lacked:

- the February versions next to the current ones, on the same machine
- data with the shape of TPC-DS, next to the synthetic data we used then
- DuckDB, and a third way to write the step

The rest of this post is what the rerun showed, and what it says about how long a finding like this stays true.

---

## The problem: orders shipped from more than one warehouse

TPC-DS queries Q16 and Q95 both keep only the orders that shipped from more than one warehouse. The query text does it with a correlated subquery (a subquery that refers to the row of the outer query)[^tpcds]:

```sql
EXISTS (
  SELECT * FROM catalog_sales cs2
  WHERE cs1.cs_order_number = cs2.cs_order_number
    AND cs1.cs_warehouse_sk <> cs2.cs_warehouse_sk
)
```

A DataFrame API has no `EXISTS`, so the step has to be rewritten. We compared two rewrites in February and added a third for the rerun. The examples use the Polars API.

**Pattern A, self-join.** It follows the SQL: pair each order's warehouses with each other and keep the pairs that differ.

```python
order_wh = df.select(["order_number", "warehouse_sk"]).unique()
multi_warehouse = (
    order_wh.join(order_wh.rename({"warehouse_sk": "wh2"}), on="order_number")
    .filter(col("warehouse_sk") != col("wh2"))
    .select("order_number")
    .unique()
)
```

**Pattern B, distinct count.** Count the distinct warehouses per order and keep counts above one.

```python
multi_warehouse = (
    df.group_by("order_number")
    .agg(col("warehouse_sk").n_unique().alias("n"))
    .filter(col("n") > 1)
    .select("order_number")
)
```

**Pattern C, minimum and maximum.** An order has more than one warehouse exactly when its smallest and largest warehouse keys differ.

```python
multi_warehouse = (
    df.group_by("order_number")
    .agg(col("warehouse_sk").min().alias("lo"), col("warehouse_sk").max().alias("hi"))
    .filter(col("lo") != col("hi"))
    .select("order_number")
)
```

Pattern C keeps two numbers per order where Pattern B keeps a set of values per order and Pattern A builds pairs.

---

## What we found in February

The February test used synthetic data: 10,000 to 1,000,000 orders, 90% with one line and 10% with two to four lines from different warehouses. It ran on an Apple M1 Mac Mini with Polars 1.37.1, DataFusion 51.0.0 and PySpark 4.1.1.

| Orders | Polars 1.37.1 | DataFusion 51.0.0 | PySpark 4.1.1 |
| --- | --- | --- | --- |
| 10K | distinct count 2.4x faster | self-join 2.1x faster | distinct count 1.7x faster |
| 100K | distinct count 3.2x faster | self-join 4.9x faster | distinct count 1.3x faster |
| 1M | distinct count 3.9x faster | self-join 5.4x faster | distinct count 1.6x faster |

The preference did not change with scale, so we concluded that it came from how each engine plans the two patterns.

BenchBox is how we noticed it. We ran TPC-DS on two DataFrame platforms:

```bash
benchbox run --platform polars-df --benchmark tpcds --scale 0.1 --phases power
benchbox run --platform datafusion-df --benchmark tpcds --scale 0.1 --phases power
```

The MCP server's `analyze_results` tool compared the two runs query by query and flagged Q16 and Q95 as outliers. `get_query_details` returned the DataFrame code for both, and both shared the multi-warehouse step. A geometric mean over all the queries would not have shown it.

BenchBox's TPC-DS DataFrame code for Q16 and Q95 has chosen the self-join on DataFusion and the distinct count elsewhere ever since:

```python
if platform == "datafusion":
    ...  # self-join
else:
    ...  # group_by + n_unique
```

---

## How we reran it

**Engines.** Each engine ran at the release we tested in February and at the newest release on November 11, 2026. DuckDB was not in the February test, so its February column is the release that was current then.

| Engine | February release | Newest release |
| --- | --- | --- |
| Polars | 1.37.1 | 2.1.0 |
| DuckDB | 1.4.4 | 2.0.0 |
| DataFusion (Python) | 51.0.0 | 55.0.0 |
| PySpark | 4.1.1 | 4.3.0 |

We also ran Polars 1.44.2 and DuckDB 1.5.6, the last 1.x releases. BenchBox 0.5.0 supports DuckDB 1.5 and does not yet accept DuckDB 2.0.

**Data.** Two shapes. The first is the February synthetic design at the same six sizes. The second is the order number and warehouse columns of the TPC-DS `catalog_sales` and `web_sales` tables at scale factor 1 and 10 (SF, the TPC-DS size setting, about 1 GB and 10 GB of raw data), generated with DuckDB's `tpcds` extension.

| Dataset | Rows | Orders | Orders with more than one warehouse |
| --- | --- | --- | --- |
| Synthetic, 1M orders | 1,199,372 | 1,000,000 | 10% |
| TPC-DS SF10 `web_sales` | 7,197,566 | 600,000 | 100% |
| TPC-DS SF10 `catalog_sales` | 14,401,261 | 1,600,000 | 99.99% |

The shapes differ a lot. A TPC-DS order has about nine to twelve lines from four to seven different warehouses, so nearly every order qualifies.

**Timing.** Each engine version ran in its own Python process with the data already in memory. One iteration ran every pattern once and collected the result as an Arrow table. We discarded two warm-up iterations and timed at least nine more. Polars ran on both of its engines: the in-memory engine, which was the default for lazy queries in 1.x, and the streaming engine, which is the default from 2.0.

**One caveat about the machine.** The test ran on an Apple M4 with 10 cores and 16 GB of RAM while other jobs were using it. We therefore report the best time of all timed runs, the figure least inflated by other work, and we rely on ratios between patterns of the same engine version, which were measured side by side. Two full passes agreed within 15% on about nine in ten of those ratios. Treat the absolute times as indicative.

---

## Results

### The February result reproduces

On the February versions and the synthetic data, the M4 gives the same picture as the M1 did.

| Orders | Polars 1.37.1 | DataFusion 51.0.0 | PySpark 4.1.1 |
| --- | --- | --- | --- |
| 10K | distinct count 2.4x faster | self-join 2.4x faster | distinct count 1.2x faster |
| 50K | distinct count 2.2x faster | self-join 4.1x faster | distinct count 1.2x faster |
| 100K | distinct count 2.7x faster | self-join 4.3x faster | distinct count 1.2x faster |
| 250K | distinct count 3.2x faster | self-join 5.5x faster | distinct count 1.3x faster |
| 500K | distinct count 3.3x faster | self-join 6.0x faster | distinct count 1.4x faster |
| 1M | distinct count 3.0x faster | self-join 6.4x faster | distinct count 1.6x faster |

So the February measurement was sound. The next two results limit how far it reaches.

### It does not hold on TPC-DS data

Same engines and versions, TPC-DS data, self-join time divided by distinct-count time. Above 1, the distinct count is faster.

| Dataset | Polars 1.37.1 | DataFusion 51.0.0 | PySpark 4.1.1 |
| --- | --- | --- | --- |
| SF1 `web_sales` | 4.3 | 0.8 | 1.4 |
| SF1 `catalog_sales` | 5.2 | 0.9 | 1.4 |
| SF10 `web_sales` | 21.9 | 1.9 | 1.6 |
| SF10 `catalog_sales` | 23.3 | 2.1 | 1.7 |

On DataFusion 51.0.0 the self-join's lead shrinks to nothing at SF1 and turns into a 2x deficit at SF10. The reason is in the data. With 10% multi-warehouse orders, the self-join emits about half as many rows as the table holds. With TPC-DS orders it emits 50 million rows from 9.4 million order-warehouse pairs at SF10, and then has to de-duplicate them. The February test measured a real effect on a shape the benchmark never produces.

### On current releases the split is gone

Best times in milliseconds on the newest releases. Polars uses its default streaming engine.

| Dataset | Engine | Self-join | Distinct count | Min/max |
| --- | --- | --- | --- | --- |
| Synthetic 1M | Polars 2.1.0 | 21.5 | 10.3 | 7.4 |
| Synthetic 1M | DuckDB 2.0.0 | 22.0 | 14.8 | 11.2 |
| Synthetic 1M | DataFusion 55.0.0 | 32.1 | 20.1 | 10.2 |
| Synthetic 1M | PySpark 4.3.0 | 854 | 561 | 372 |
| SF10 `catalog_sales` | Polars 2.1.0 | 433 | 79.3 | 27.9 |
| SF10 `catalog_sales` | DuckDB 2.0.0 | 682 | 169 | 46.5 |
| SF10 `catalog_sales` | DataFusion 55.0.0 | 518 | 161 | 37.4 |
| SF10 `catalog_sales` | PySpark 4.3.0 | 4,861 | 2,970 | 536 |

On DataFusion 55.0.0 the distinct count is faster than the self-join on all ten datasets, by 1.4-1.6x on synthetic data and 2.6-3.5x on TPC-DS data. The distinct count on the synthetic 1M dataset took 221 ms on DataFusion 51.0.0 and 20.1 ms on 55.0.0, while the self-join stayed near 33 ms. The pattern that DataFusion needed in February is the slower one today, on either data shape.

Polars changed too. On the in-memory engine the self-join is 15-23x slower than the distinct count on SF10 data in every Polars release we ran. On the streaming engine of Polars 2.1.0 it is about 5x slower. A project that upgrades to Polars 2 gets the streaming engine for lazy queries without changing its code[^polars2], and with it a different cost for the same pattern.

### A third pattern is faster than both

Pattern C was the fastest of the patterns in 39 of the 40 combinations of current release and dataset. The exception is DuckDB 2.0.0 at 100K synthetic orders, where the distinct count was 16% faster, half a millisecond. On SF10 data, min/max was 2.8-2.9x faster than the distinct count on Polars 2.1.0, 3.5-3.6x on DuckDB 2.0.0, 3.7-4.3x on DataFusion 55.0.0 and 4.9-5.5x on PySpark 4.3.0.

On the February versions it wins less uniformly. On the Polars 1.37.1 in-memory engine the distinct count was 1.3-1.7x faster than min/max on synthetic data and about level with it on TPC-DS data. On DataFusion 51.0.0, min/max was 6-17x faster than the distinct count. It was also faster than the self-join we had picked for DataFusion, by 2.6-2.9x on synthetic data and 6-22x on TPC-DS data.

In February we compared two patterns and found that each engine needed a different one. A pattern we did not test would have served both.

### The SQL form on DuckDB changed with 2.0

DuckDB runs the `EXISTS` form as written, so we timed it alongside the rewrites, as one statement over the whole table.

| Dataset | DuckDB 1.4.4 | DuckDB 1.5.6 | DuckDB 2.0.0 |
| --- | --- | --- | --- |
| Synthetic 1M | 14.0 ms | 13.1 ms | 14.3 ms |
| SF1 `catalog_sales` | 12.5 ms | 12.4 ms | 44.3 ms |
| SF10 `web_sales` | 52.2 ms | 51.7 ms | 314 ms |
| SF10 `catalog_sales` | 112 ms | 111 ms | 5,063 ms |

On the three TPC-DS rows the isolated statement is 3.6, 6.1 and 45 times slower on 2.0.0 than on 1.5.6. The plans differ: 1.5.6 runs one semi join (a join that only checks whether a match exists) with the inequality as a join condition, and 2.0.0 on these datasets builds the matching pairs with an inner join first.

We then ran the complete Q16, Q94 and Q95 on the same three DuckDB versions, and the result did not carry over. Q16 at SF10 takes 7 ms on all three. Q95 at SF10 takes 383 ms on 1.5.6 and 69 ms on 2.0.0. The complete queries carry selective filters on date, address and call center or web site that the isolated statement lacks. A slow isolated pattern did not make a slow query.

---

## Why the patterns cost what they do

The plans explain most of this.

**Self-join.** Every engine de-duplicates the order-warehouse pairs, joins them, and de-duplicates again. The join output grows with the square of the warehouses per order, which is why TPC-DS data hurts it. Polars computes the pairs once and caches them for both sides of the join. PySpark shuffles (moves rows between partitions so equal keys meet)[^shuffle] four times for this pattern, against two for the distinct count and one for min/max.

**Distinct count.** The engine keeps the set of warehouses seen for each order. DataFusion 51.0.0 and 55.0.0 plan it the same way, a partial and a final aggregate, and the time for it differs by 11x on the synthetic 1M dataset. We did not trace which change made the difference.

**Min/max.** One pass, two values per order, and no set to maintain. In every engine the plan is a single grouped aggregate followed by a filter.

One correctness point belongs here. In SQL, `<>` is never true when a side is NULL, so an order with one warehouse and one missing warehouse is not a multi-warehouse order. Polars `n_unique()` counts NULL as a value[^nunique] and does include that order. On TPC-DS `catalog_sales` at SF10 it returned 1,599,816 orders where every other pattern and engine returned 1,599,778. Dropping NULLs first fixes it, which BenchBox's Q16 does. `min` and `max` skip NULLs on all four engines, so Pattern C matched the SQL answer without extra care.

---

## What this means for BenchBox

The platform branch is still in BenchBox 0.5.0. Measured on the isolated step with TPC-DS data and DataFusion 55.0.0, it gives DataFusion the slower of its two options, and both options are slower than min/max on the current release of every platform we ran.

We have not changed it yet, for a reason the DuckDB result makes plain: this test times the step alone, over a whole table. The DataFrame versions of Q16 and Q95 compute the multi-warehouse orders for the full table before they apply the query's other filters, so we expect the step to matter more there than it does in SQL, but that is an expectation until the complete queries are timed with each pattern.

---

## What we learned about benchmarking

**A tuning has a version and a data shape attached.** The February result was reproducible and well explained, and four DataFusion releases later it was out of date. A platform-specific code path needs the versions and data it was measured on recorded next to it, and a date to measure it again.

**Test data should have the benchmark's shape.** Our synthetic orders had 1.2 lines each. TPC-DS orders have about ten. The pattern we tuned is sensitive to exactly that number.

**Two candidates are not the search space.** We framed the question as self-join against distinct count and answered it carefully. The better answer was outside the frame.

**A step is not a query.** The isolated `EXISTS` statement is 45x slower on DuckDB 2.0.0 than on 1.5.6 at SF10, and the query that contains it takes the same 7 ms. Per-query timing is what BenchBox reports, and it is the level at which a change like the platform branch has to be judged.

---

## Test environment

- **Hardware**: Apple M4, 10 cores, 16 GB RAM, macOS 27.0.1. The machine was shared with other jobs during the test.
- **Software**: Python 3.12; Polars 1.37.1, 1.44.2 and 2.1.0; DuckDB 1.4.4, 1.5.6 and 2.0.0; DataFusion 51.0.0 and 55.0.0; PySpark 4.1.1 and 4.3.0 on OpenJDK 21. Default settings and thread counts; Spark in `local[*]` mode.
- **Data**: the February synthetic design at six sizes, and TPC-DS `catalog_sales` and `web_sales` at SF1 and SF10 from DuckDB's `tpcds` extension, order number and warehouse columns only.
- **Method**: data in memory, two warm-up iterations, at least nine timed iterations with the patterns interleaved, best wall time reported, two full passes.
- **Evidence**: the harness, every timing, the medians and the query plans are in `drafts/benchbox-in-action/research/multi-warehouse-patterns-remeasured-2026-11-11.md` in the site repository.

## Limitations

- The machine was not idle. Ratios between patterns on one engine version are the reliable figures. Absolute times, and absolute comparisons between versions, carry more error.
- The step was timed alone. Only DuckDB was also run on the complete Q16, Q94 and Q95. The DataFrame platforms were not.
- One machine, one architecture, one node. A Spark cluster pays more for each shuffle than `local[*]` mode does.
- One query step. Other steps may still need different code on different platforms.

---

## Conclusions

The same query did need different code in February, on the versions and data we tested. Nine months later it does not: one pattern is fastest on Polars 2.1.0, DuckDB 2.0.0, DataFusion 55.0.0 and PySpark 4.3.0, on both data shapes, in all but one of 40 tests.

Running the old releases next to the new ones is what made the result readable. Without them we could not have told a mistake in February from a change in the engines. It was neither a mistake nor only a change: the measurement was right, the data was the wrong shape, and the engines moved.

To check the numbers on your own machine, the research note has the two scripts and the commands. Each pass takes about half an hour.

---

## References

[^tpcds]: [TPC-DS Standard Specification v3.2.0](https://www.tpc.org/tpc_documents_current_versions/pdf/tpc-ds_v3.2.0.pdf), query templates for Q16 and Q95.

[^polars2]: [Polars upgrade guide, version 2.0](https://docs.pola.rs/releases/upgrade/2/), section "The Lazy API defaults to the streaming engine", accessed November 11, 2026.

[^duckdb2]: [Announcing DuckDB 2.0.0](https://duckdb.org/2026/10/21/announcing-duckdb-200.html), DuckDB, October 21, 2026.

[^shuffle]: [Spark RDD Programming Guide](https://spark.apache.org/docs/latest/rdd-programming-guide.html#shuffle-operations), section "Shuffle operations".

[^nunique]: [polars.Expr.n_unique](https://docs.pola.rs/api/python/stable/reference/expressions/api/polars.Expr.n_unique.html): "`null` is considered to be a unique value for the purposes of this operation."

---

*Questions or feedback? [Open an issue](https://github.com/BenchBox-dev/BenchBox/issues) or join the discussion.*
