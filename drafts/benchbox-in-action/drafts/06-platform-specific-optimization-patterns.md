---
blogpost: true
date: November 20, 2026
author: Joe Harris
series: benchbox-in-action
post_number: 7
requires_release: 0.5.1
type: technical-challenge
tags: benchmarking, benchbox, polars, duckdb, datafusion, pyspark, tpc-ds, dataframe, query-optimization
meta_description: "In February two DataFrame patterns had opposite winners on Polars and DataFusion. Rerun on current releases and TPC-DS data, a third pattern is fastest on all four engines."
---

# BenchBox in action: when the same query needs different code

> In February, two ways of writing one TPC-DS step had opposite winners on Polars and DataFusion, and we added a platform branch to BenchBox to use a different one on each. The branch never ran: a letter-case mismatch kept it false on every platform. We reran the test in November on old and new engine releases. The February result reproduces, but only on the data shape and versions we tested then.

**TL;DR**: In February the self-join was 2-5x faster on DataFusion 51 and the distinct count 2-4x faster on Polars 1.37 for one step of TPC-DS Q16 and Q95, so we added a platform branch to BenchBox. The branch never ran: it compared against a lower-case platform name that DataFusion reports with capitals, so every platform used the distinct count. Rerun on an Apple M4 in November, the split reproduces on those versions with synthetic data, reverses on TPC-DS data for DataFusion 51, and is gone on DataFusion 55. A third pattern, comparing the minimum and maximum warehouse per order, was fastest in 39 of 40 tests on the current releases of Polars, DuckDB, DataFusion and PySpark. BenchBox 0.5.1 uses it for Q16, Q94 and Q95 on every platform, and on Polars, DataFusion and PySpark the complete queries run 8-51% faster than on 0.5.0 at SF1.

---

## Introduction

BenchBox runs each benchmark query as SQL and, on DataFrame platforms, as DataFrame code written once against a common interface. In February 2026 we found a step in two TPC-DS queries where one way of writing that code was several times faster on Polars and another was several times faster on DataFusion. We measured it, read the query plans, and added a branch meant to pick the pattern by platform. The branch never took effect, as described below.

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

We added a branch to the DataFrame code for Q16 and Q95 that was meant to choose the self-join on DataFusion and the distinct count elsewhere:

```python
if platform == "datafusion":  # never true: the DataFusion adapter reports "DataFusion"
    ...  # self-join
else:
    ...  # group_by + n_unique
```

The comparison was false on every platform in every release from v0.1.1 to v0.5.0, so DataFusion took the distinct-count path like every other platform. The February speed-up for DataFusion was never in BenchBox's results.

---

## How we reran it

**Engines.** Each engine ran at the release we tested in February and at the newest release on November 20, 2026, the same releases as on November 11. DuckDB was not in the February test, so its February column is the release that was current then.

| Engine | February release | Newest release |
| --- | --- | --- |
| Polars | 1.37.1 | 2.1.0 |
| DuckDB | 1.4.4 | 2.0.0 |
| DataFusion (Python) | 51.0.0 | 55.0.0 |
| PySpark | 4.1.1 | 4.3.0 |

We also ran Polars 1.44.2 and DuckDB 1.5.6, the last 1.x releases. BenchBox 0.5.0, the release current when we ran the test, accepts DuckDB 1.5 and not 2.0. BenchBox 0.5.1 accepts DuckDB 2.0.

**Data.** Two shapes. The first is the February synthetic design at the same six sizes. The second is the order number and warehouse columns of the TPC-DS `catalog_sales` and `web_sales` tables at scale factor 1 and 10 (SF, the TPC-DS size setting, about 1 GB and 10 GB of raw data), generated with DuckDB's `tpcds` extension.

| Dataset | Rows | Orders | Orders with more than one warehouse |
| --- | --- | --- | --- |
| Synthetic, 1M orders | 1,199,372 | 1,000,000 | 10% |
| TPC-DS SF10 `web_sales` | 7,197,566 | 600,000 | 100% |
| TPC-DS SF10 `catalog_sales` | 14,401,261 | 1,600,000 | 99.99% |

The shapes differ a lot. A TPC-DS order has about nine to twelve lines from four to seven different warehouses, so nearly every order qualifies.

**Timing.** Each engine version ran in its own Python process with the data already in memory. One iteration ran every pattern once and collected the result as an Arrow table. We discarded two warm-up iterations and timed at least nine more. Polars ran on both of its engines: the in-memory engine, which was the default for lazy queries in 1.x, and the streaming engine, which is the default from 2.0.

**The machine.** An Apple M4 with 10 cores and 16 GB of RAM, with no other benchmark or build jobs running. A first run on November 11 shared the machine with other jobs; we discarded its timings and reran on November 19 and 20. We report the best time of all timed runs, and ratios between patterns of the same engine version, which were measured side by side. Ratios of the per-pass median times agreed between the two passes within 5% for nine in ten and within 11% for all.

---

## Results

### The February result reproduces

On the February versions and the synthetic data, the M4 gives the same picture as the M1 did.

| Orders | Polars 1.37.1 | DataFusion 51.0.0 | PySpark 4.1.1 |
| --- | --- | --- | --- |
| 10K | distinct count 2.3x faster | self-join 2.3x faster | distinct count 1.2x faster |
| 50K | distinct count 2.3x faster | self-join 5.6x faster | distinct count 1.2x faster |
| 100K | distinct count 2.7x faster | self-join 5.5x faster | distinct count 1.2x faster |
| 250K | distinct count 3.2x faster | self-join 6.1x faster | distinct count 1.3x faster |
| 500K | distinct count 3.2x faster | self-join 5.9x faster | distinct count 1.4x faster |
| 1M | distinct count 2.9x faster | self-join 6.7x faster | distinct count 1.5x faster |

So the February measurement was sound. The next two results limit how far it reaches.

### It does not hold on TPC-DS data

Same engines and versions, TPC-DS data, self-join time divided by distinct-count time. Above 1, the distinct count is faster.

| Dataset | Polars 1.37.1 | DataFusion 51.0.0 | PySpark 4.1.1 |
| --- | --- | --- | --- |
| SF1 `web_sales` | 4.0 | 0.7 | 1.3 |
| SF1 `catalog_sales` | 5.1 | 0.9 | 1.3 |
| SF10 `web_sales` | 12.8 | 1.8 | 1.4 |
| SF10 `catalog_sales` | 13.8 | 1.8 | 1.7 |

On DataFusion 51.0.0 the self-join's lead shrinks to 1.2-1.4x at SF1 and turns into a 1.8x deficit at SF10. The reason is in the data. With 10% multi-warehouse orders, the self-join emits about half as many rows as the table holds. With TPC-DS orders it emits 50 million rows from 9.4 million order-warehouse pairs at SF10, and then has to de-duplicate them. The February test measured a real effect on a shape the benchmark never produces.

### On current releases the split is gone

Best times in milliseconds on the newest releases. Polars uses its default streaming engine.

| Dataset | Engine | Self-join | Distinct count | Min/max |
| --- | --- | --- | --- | --- |
| Synthetic 1M | Polars 2.1.0 | 20.0 | 9.2 | 7.2 |
| Synthetic 1M | DuckDB 2.0.0 | 21.2 | 14.1 | 10.5 |
| Synthetic 1M | DataFusion 55.0.0 | 31.1 | 19.8 | 10.2 |
| Synthetic 1M | PySpark 4.3.0 | 753 | 521 | 343 |
| SF10 `catalog_sales` | Polars 2.1.0 | 392 | 69.0 | 26.0 |
| SF10 `catalog_sales` | DuckDB 2.0.0 | 378 | 108 | 30.3 |
| SF10 `catalog_sales` | DataFusion 55.0.0 | 455 | 148 | 32.1 |
| SF10 `catalog_sales` | PySpark 4.3.0 | 2,827 | 1,864 | 393 |

On DataFusion 55.0.0 the distinct count is faster than the self-join on all ten datasets, by 1.3-1.6x on synthetic data and 2.6-3.5x on TPC-DS data. The distinct count on the synthetic 1M dataset took 227 ms on DataFusion 51.0.0 and 19.8 ms on 55.0.0, while the self-join stayed at 31-34 ms. The pattern that was fastest on DataFusion in February is the slower one today, on either data shape.

Polars changed too. On the in-memory engine the self-join is 13-15x slower than the distinct count on SF10 data in every Polars release we ran. On the streaming engine of Polars 2.1.0 it is about 5.5x slower. A project that upgrades to Polars 2 gets the streaming engine for lazy queries without changing its code[^polars2], and with it a different cost for the same pattern.

### A third pattern is faster than both

Pattern C was the fastest of the patterns in 39 of the 40 combinations of current release and dataset. The exception is DuckDB 2.0.0 at 100K synthetic orders, where the distinct count was 16% (0.6 ms) faster. On SF10 data, min/max was 2.7-2.8x faster than the distinct count on Polars 2.1.0, 3.6x on DuckDB 2.0.0, 3.6-4.6x on DataFusion 55.0.0 and 4.1-4.7x on PySpark 4.3.0.

On the February versions it wins less uniformly. On the Polars 1.37.1 in-memory engine the distinct count was 1.3-2.1x faster than min/max on synthetic data and about level with it on TPC-DS data. On DataFusion 51.0.0, min/max was 6-18x faster than the distinct count. It was also faster than the self-join, which had been the faster of the two on DataFusion 51.0.0 in February, by 2.5-3.0x on synthetic data and 6-18x on TPC-DS data.

In February we compared two patterns and each engine preferred a different one. A pattern we did not test is faster than both on the current releases.

### The SQL form on DuckDB changed with 2.0

DuckDB runs the `EXISTS` form as written, so we timed it alongside the rewrites, as one statement over the whole table.

| Dataset | DuckDB 1.4.4 | DuckDB 1.5.6 | DuckDB 2.0.0 |
| --- | --- | --- | --- |
| Synthetic 1M | 13.0 ms | 12.7 ms | 13.8 ms |
| SF1 `catalog_sales` | 12.2 ms | 12.1 ms | 43.0 ms |
| SF10 `web_sales` | 48.0 ms | 48.9 ms | 266 ms |
| SF10 `catalog_sales` | 102 ms | 104 ms | 540 ms |

On the three TPC-DS rows the isolated statement is 3.6, 5.4 and 5.2 times slower on 2.0.0 than on 1.5.6. The plans differ: 1.5.6 runs one semi join (a join that only checks whether a match exists) with the inequality as a join condition, and 2.0.0 on these datasets builds the matching pairs with an inner join first.

We then ran the complete Q16, Q94 and Q95 on the same three DuckDB versions, and the result did not carry over. Q16 at SF10 takes 7 to 8 ms on all three. Q95 at SF10 takes 332 ms on 1.5.6 and 60 ms on 2.0.0. The complete queries carry selective filters on date, address and call center or web site that the isolated statement lacks. A slow isolated pattern did not make a slow query.

---

## Why the patterns cost what they do

The plans explain most of this.

**Self-join.** Every engine de-duplicates the order-warehouse pairs, joins them, and de-duplicates again. The join output grows with the square of the warehouses per order, which is why TPC-DS data hurts it. Polars computes the pairs once and caches them for both sides of the join. PySpark shuffles (moves rows between partitions so equal keys meet)[^shuffle] four times for this pattern, against two for the distinct count and one for min/max.

**Distinct count.** The engine keeps the set of warehouses seen for each order. DataFusion 51.0.0 and 55.0.0 plan it the same way, a partial and a final aggregate, and the time for it differs by 11x on the synthetic 1M dataset. We did not trace which change made the difference.

**Min/max.** One pass, two values per order, and no set to maintain. In every engine the plan is a single grouped aggregate followed by a filter.

One correctness point belongs here. In SQL, `<>` is never true when a side is NULL, so an order with one warehouse and one missing warehouse is not a multi-warehouse order. Polars `n_unique()` counts NULL as a value[^nunique] and does include that order. On TPC-DS `catalog_sales` at SF10 it returned 1,599,816 orders where every other pattern and engine returned 1,599,778. Dropping NULLs first fixes it, which BenchBox's Q16 does. `min` and `max` skip NULLs on all four engines, so Pattern C matched the SQL answer without extra care.

---

## What this means for BenchBox

The platform branch was in every BenchBox release through 0.5.0. As shown above, DataFusion therefore always ran the group-by and distinct-count path for Q16 and Q95. Q94 ran the self-join on every platform that shares the expression code, because its helper was called with the optimized flag off.

The same code had two NULL defects. On Polars, `n_unique()` counts NULL, so Q95 treated an order with one real warehouse and one NULL warehouse as a multi-warehouse order. The pandas implementations of Q94 and Q95 made the same error, and Q94 kept sales rows whose own warehouse is NULL, which the SQL excludes. We know of no published answer that this changed.

BenchBox [pull request 4169](https://github.com/BenchBox-dev/BenchBox/pull/4169), shipped in 0.5.1, removed the dead branches, fixed the NULL handling, and moved Q16, Q94 and Q95 to the minimum and maximum rule on every platform. A second change, [pull request 4196](https://github.com/BenchBox-dev/BenchBox/pull/4196), covers TPC-H Q21, which has the same kind of step. There, carrying the minimum and maximum through the joins was about 10% slower on DataFusion than two distinct counts, and filtering before the joins brought it level.

We timed the complete queries on both sides of that change. The test ran the complete DataFrame Q16, Q94 and Q95 through `benchbox run` from the published BenchBox 0.5.0 and 0.5.1, with the same engine releases on both: Polars 2.1.0, DataFusion 55.0.0 and PySpark 4.3.0. The data was TPC-DS at scale factor 1. Each side had 15 timed runs, in three rounds that alternated which release ran first. "Before" (0.5.0) ran the distinct count for Q16 and Q95 and the self-join for Q94 on every engine; "after" (0.5.1) ran min/max for all three. Median times in milliseconds:

| Query | Engine | 0.5.0 | 0.5.1 | Ratio |
| --- | --- | --- | --- | --- |
| Q16 | Polars 2.1.0 | 30.2 | 25.3 | 0.84 |
| Q94 | Polars 2.1.0 | 27.2 | 19.1 | 0.70 |
| Q95 | Polars 2.1.0 | 20.7 | 19.0 | 0.92 |
| Q16 | DataFusion 55.0.0 | 76.1 | 57.2 | 0.75 |
| Q94 | DataFusion 55.0.0 | 63.2 | 32.5 | 0.51 |
| Q95 | DataFusion 55.0.0 | 48.3 | 31.4 | 0.65 |
| Q16 | PySpark 4.3.0 | 1,508 | 748 | 0.50 |
| Q94 | PySpark 4.3.0 | 1,094 | 532 | 0.49 |
| Q95 | PySpark 4.3.0 | 1,148 | 680 | 0.59 |

The ratio is the 0.5.1 time divided by the 0.5.0 time, so below 1 is faster. Every query is faster on 0.5.1 on every engine: by 8-30% on Polars, 25-49% on DataFusion and 41-51% on PySpark. On DataFusion, the first timed run of Q16 in each set was about twice as fast as the four after it, on both releases, so the table uses medians.

Two things this test did not cover. Scale factor 10 did not run, because BenchBox's memory check refused it on this 16 GB machine. And BenchBox records only the row count of these queries, one row each, so we did not compare the answer values between the two releases.

---

## What we learned about benchmarking

**A tuning has a version and a data shape attached.** The February result was reproducible and well explained, and four DataFusion releases later it was out of date. A measured preference for one pattern on one engine needs the versions and data it was measured on recorded next to it, and a date to measure it again.

**Test data should have the benchmark's shape.** Our synthetic orders had 1.2 lines each. TPC-DS orders have about ten. The patterns we compared are sensitive to exactly that number.

**Two candidates are not the search space.** We framed the question as self-join against distinct count and answered it carefully. The better answer was outside the frame.

**A step is not a query.** The isolated `EXISTS` statement is 5x slower on DuckDB 2.0.0 than on 1.5.6 at SF10, and the query that contains it takes the same 7 to 8 ms. Per-query timing is what BenchBox reports, and it is the level at which a change to Q16, Q94 or Q95 has to be judged.

**A platform branch needs a check that it runs.** BenchBox's branch compared against a string the DataFusion adapter never reports, and no result showed it, because the path that ran instead returned correct answers. A test that the DataFusion path is taken would have caught it in February.

---

## Test environment

- **Hardware**: Apple M4, 10 cores, 16 GB RAM, macOS 27.0.1, with no other benchmark or build jobs running.
- **Software**: Python 3.12; Polars 1.37.1, 1.44.2 and 2.1.0; DuckDB 1.4.4, 1.5.6 and 2.0.0; DataFusion 51.0.0 and 55.0.0; PySpark 4.1.1 and 4.3.0 on OpenJDK 21; BenchBox 0.5.0 and 0.5.1. Default settings and thread counts; Spark in `local[*]` mode.
- **Data**: the February synthetic design at six sizes, and TPC-DS `catalog_sales` and `web_sales` at SF1 and SF10 from DuckDB's `tpcds` extension, order number and warehouse columns only. The complete queries used full TPC-DS data at SF1 (DataFrame) and SF1 and SF10 (DuckDB SQL).
- **Method**: for the isolated step, data in memory, two warm-up iterations, at least nine timed iterations with the patterns interleaved, best wall time reported, two full passes. For the complete queries, two warm-up and nine timed runs per DuckDB version, and three runs of one warm-up and five timed passes per BenchBox release and DataFrame engine.
- **Evidence**: the harness, every timing, the medians and the query plans are in `drafts/benchbox-in-action/research/multi-warehouse-patterns-remeasured-2026-11-11.md` in the site repository.

## Limitations

- The complete DataFrame queries ran at scale factor 1 only, because BenchBox's memory check refused scale factor 10 on a 16 GB machine, and their answer values were not compared between releases.
- One machine, one architecture, one node. A Spark cluster pays more for each shuffle than `local[*]` mode does.
- One query step. Other steps may still need different code on different platforms.

---

## Conclusions

In February two patterns had different winners on different engines, on the versions and data we tested. Nine months later one pattern is fastest on Polars 2.1.0, DuckDB 2.0.0, DataFusion 55.0.0 and PySpark 4.3.0, on both data shapes, in all but one of 40 tests.

Running the old releases next to the new ones is what made the result readable. Without them we could not have told a mistake in February from a change in the engines. It was neither a mistake nor only a change: the measurement was right, the data was the wrong shape, and the engines moved.

To check the numbers on your own machine, the research note has the scripts and the commands. Each pass of the isolated-step test takes about 25 minutes.

---

## References

[^tpcds]: [TPC-DS Standard Specification v3.2.0](https://www.tpc.org/tpc_documents_current_versions/pdf/tpc-ds_v3.2.0.pdf), query templates for Q16 and Q95.

[^polars2]: [Polars upgrade guide, version 2.0](https://docs.pola.rs/releases/upgrade/2/), section "The Lazy API defaults to the streaming engine", accessed November 11, 2026.

[^duckdb2]: [Announcing DuckDB 2.0.0](https://duckdb.org/2026/10/21/announcing-duckdb-200.html), DuckDB, October 21, 2026.

[^shuffle]: [Spark RDD Programming Guide](https://spark.apache.org/docs/latest/rdd-programming-guide.html#shuffle-operations), section "Shuffle operations".

[^nunique]: [polars.Expr.n_unique](https://docs.pola.rs/api/python/stable/reference/expressions/api/polars.Expr.n_unique.html): "`null` is considered to be a unique value for the purposes of this operation."

---

*Questions or feedback? [Open an issue](https://github.com/BenchBox-dev/BenchBox/issues) or join the discussion.*
