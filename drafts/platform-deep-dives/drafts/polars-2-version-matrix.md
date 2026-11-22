---
blogpost: true
date: [TODO: set on publication]
author: Joe Harris
series: platform-deep-dives
type: benchbox-in-action
tags: polars, dataframe, upgrade, tpc-h, tpc-ds, ssb, clickbench, benchmarking
meta_description: "Is Polars 2.x worth the upgrade? We ported 181 benchmark queries and measured speed and memory against 1.44: up to 2x faster, with two things to check first."
---

# Polars 2.x is up to 2x faster. Should you upgrade?

> You will get the most lift from Polars 2.x if you currently rely on defaults. 2.x now uses `streaming` by default instead of `in-memory`, and that change significantly improves performance in our tests.

**TL;DR**: With default settings, Polars 2.x took 36% to 53% less time than 1.44 on three benchmarks, and porting the 181 queries we tested took three small fixes. Much of the gain comes from the new default engine, so it is smaller if you already use the streaming engine, and we measured none on the in-memory engine. Before you upgrade, check any code that relies on row order, and test large group-bys on 2.1 if you run close to your memory limit.

---

## Introduction

Polars 2.0 came out on 2026-10-06 and 2.1 on 2026-10-25[^1]. The Polars team says the release changes defaults more than it adds features: "We don't aim to make a big feature release of Polars 2.0. In fact we hope it to be a boring experience for you."[^2]

We wanted to know how fast 2.x is and how much work the upgrade takes. So we ran four benchmarks on Polars 1.44, 2.0 and 2.1: TPC-H, TPC-DS, SSB and ClickBench. All tests read Parquet files on a laptop with 16 GiB of memory.

The biggest change is the engine. The engine is the part of Polars that runs a query, and Polars has two. The in-memory engine loads all the data a query needs at once. The streaming engine works through the data in batches.

The engine you get depends on how you write your code:

- **Eager code** runs each step straight away, for example `pl.read_parquet(...)` followed by `df.filter(...)`. It uses the in-memory engine.
- **`collect()` queries** build a plan first, for example with `pl.scan_parquet(...)` or `df.lazy()`, and run when you call `collect()`. In 1.x they used the in-memory engine. In 2.x they use the streaming engine.

All our tests are `collect()` queries.

## Upgrade or wait

- **You call `collect()` and do not set an engine:** the largest gain. Our tests took 36% to 53% less time. Check any code that relies on row order first.
- **You already pass `engine="streaming"`:** a smaller gain, 14% to 29%.
- **You keep the in-memory engine:** we measured no change in speed. Eager code uses this engine too, but we did not test eager code.
- **You run large `group_by` queries close to your memory limit:** test on 2.1 before you move. One of our queries needed far more memory on 2.1 than on 2.0.
- **Your pipelines sometimes run out of memory:** 2.x can use disk as overflow, and this is on by default. In 2.1 it covers sorting, `group_by` and window functions.

## Breaking changes in 2.0

The migration guide lists every change[^3]. These are the four main ones.

**`collect()` uses the streaming engine.** So does SQL that you run with `pl.sql(..., eager=True)`[^3].

**Row order can change.** The streaming engine does not keep rows in their original order through `join`, `group_by` and `unpivot`. The guide warns: "This change may silently impact the results of your pipelines."[^3] If your code needs a particular order, sort the result or pass `maintain_order`:

```python
left.join(right, on="k", how="left", maintain_order="left").collect()
```

**Some conversions now fail with an error.** Polars used to convert types quietly in a few places. For example, `is_in` no longer converts both sides to a shared type. To turn a string into a date, you now call `.str.to_date()`[^2].

**Old APIs are removed.** Examples are `melt`, `with_row_count`, `LazyFrame.fetch` and the `rechunk=` argument of the file readers[^3]. The error message tells you what to use instead[^2].

To keep the in-memory engine after you upgrade[^3]:

```python
pl.Config.set_engine_affinity("in-memory")   # whole process
lf.collect(engine="in-memory")               # one query
```

## Polars can now use disk when memory runs out

This change breaks nothing. It matters most if you run Polars pipelines on a schedule, where a run that outgrows memory fails with nobody watching.

In 2.0, the streaming engine tracks how much memory it is using. When that passes 80% of the memory available, it moves part of its working data to disk and reads it back when needed[^4]. Inside a container, "available" means the container's limit. This is on by default, and Polars will use up to 64 GB of disk for it[^4].

The aim is that a query which has outgrown memory finishes more slowly instead of failing. So far it covers these operations:

- **In 2.0:** sorting[^4]
- **In 2.1:** `group_by` and window functions[^5]
- **Not yet released:** joins[^6]

We forced it with a small test. We sorted 12 million rows while allowing Polars 200 MB of memory. Polars 2.0 finished the sort and wrote 1.12 GB to disk on the way. In our TPC-DS runs, 2.1 wrote 0.47 GiB to disk and finished every run.

Two things to know before you rely on it:

- **The threshold is not a hard limit.** One of our queries used 7.6 GiB with the limit set to 4 GB. The memory section below has the details.
- **The disk files need room.** On our machine they went to `polars-<user>/spill` under the system temporary directory. You can change the two limits with `POLARS_OOC_MEMORY_BUDGET_MB` and `POLARS_OOC_DISK_BUDGET_MB`.

## Porting 181 queries: three fixes

The four benchmarks have 181 queries between them. To run them on 2.0 we made [three fixes](https://github.com/BenchBox-dev/BenchBox/pull/2771):

1. We stopped passing `rechunk=` to `scan_csv` and `scan_parquet`, because 2.0 removed it.
2. We switched a CSV option from `missing_utf8_is_empty_string=` to `empty_string_is_null=`. The new option means the opposite, so we flipped its value.
3. We replaced a conversion from string to date with `str.to_date()`.

All three fixes were in code that the queries share. We did not change any query. After the fixes, every benchmark passed our check against DuckDB, which we use as a reference, on 2.0 and 2.1.

## Speed by starting point

The table shows the total time, in seconds, to run all the queries in each benchmark. Each number is the median of three runs. The data is at scale factor 10, which for TPC-H is about 10 GB.

| Benchmark | 1.44, default (in-memory) | 1.44, streaming | 2.0, default (streaming) | 2.1, default (streaming) |
|---|---|---|---|---|
| TPC-H | 11.17 | 7.75 | 6.11 | 5.75 |
| SSB | 5.18 | 4.19 | 3.28 | 3.32 |
| ClickBench | 4.32 | 2.55 | 2.10 | 2.05 |

**If you use the defaults.** 2.x roughly halved the time for TPC-H and ClickBench, and cut SSB by over a third. That is 1.6x to 2.1x faster.

**If you already use streaming.** Much of that gain was already available in 1.44. Switching 1.44 to the streaming engine took 19% to 41% off the time. Moving from there to 2.x took off another 14% to 29%.

**If you keep the in-memory engine.** 2.0 and 2.1 were within about 8% of 1.44 on every benchmark. With three runs, a difference that small could be noise.

2.0 and 2.1 were within 9% of each other on these three benchmarks.

## Memory on a 16 GiB machine

With the defaults, 2.x used less memory than 1.44 on all three benchmarks above. On SSB, peak memory fell from 5.1 GiB to 2.2 GiB. These readings varied by up to 1.9 GiB between repeat runs, so treat them as rough.

TPC-DS is the largest of the four benchmarks. It shows the difference most clearly:

| TPC-DS at scale factor 10 | Result |
|---|---|
| 1.44, default (in-memory) | Did not finish. The machine ran out of memory and the run was stopped. |
| 1.44, streaming | 57.21 s |
| 2.0, default (streaming) | 30.47 s |
| 2.1, default (streaming) | 34.08 s |

2.0 finished without using disk. 2.1 wrote 0.47 GiB of working data to disk, and the machine started to swap. Swap means the operating system moves memory to disk because RAM is full, which slows everything down.

### One query explains the 2.1 result

2.1 took about 12% longer than 2.0 on TPC-DS. One query out of 103 accounts for that:

| Default engine, median of three runs | 2.0 | 2.1 |
|---|---|---|
| Query 4 | 4.67 s | 10.28 s |
| The other 102 queries | 25.80 s | 23.80 s |

On the other 102 queries, 2.1 took 8% less time than 2.0.

Query 4 adds up what each customer spent per year in three sales tables. It stacks the three results into one table, then uses that table six times.

We ran query 4 by itself to check. On 2.0 it finished in 7 seconds and did not use disk. On 2.1 its memory grew to 7.6 GiB, and a safety limit on our machine stopped it. We had told Polars to use no more than 4 GB.

Polars 2.1 has a new implementation of `group_by` for the streaming engine[^7]. Two open Polars bug reports describe memory problems with two things this query does. One is stacking tables with `pl.concat`, where the report measures four times the memory of 2.0[^8]. The other is using one result in several places[^9]. We did not confirm which of these affects query 4. Polars has changed how `group_by` uses memory since 2.1, but those changes are not in a release yet[^10].

## Row order: test your own code

Polars does not raise an error when row order changes, so you have to look for it yourself. Read your code for places that depend on the order of rows after a `join` or `group_by`. Then run it on 2.x twice, once with the defaults and once with `engine="in-memory"`. Compare the two outputs without sorting them.

Our benchmarks cannot make this check for you. Each query either sorts its output or does not promise any order.

## Test setup

- **Hardware**: Apple M4, 10 cores, 16 GiB of memory, macOS 27.0.1
- **Software**: Python 3.12.15; Polars 1.44.2, 2.0.0 and 2.1.0; BenchBox at commit `82e76af81`
- **Benchmarks**: TPC-H, TPC-DS, SSB and ClickBench at scale factor 10, read from Parquet files
- **Method**: 10 threads. Each query ran once to warm up and once for timing. We ran each benchmark three times, in random order.
- **Checks**: at a small data size we compared query results with DuckDB. At scale factor 10 we compared row counts.

We also ran three older 1.x releases. The [findings](https://github.com/BenchBox-dev/BenchBox/blob/3e09d4f43bbfb823acd82dc1402dd4db9663c634/_project/analysis/polars-version-matrix/findings.md) list every result. The [methodology](https://github.com/BenchBox-dev/BenchBox/blob/3e09d4f43bbfb823acd82dc1402dd4db9663c634/_project/analysis/polars-version-matrix/methodology.md) explains the rules. The [analysis JSON](https://github.com/BenchBox-dev/BenchBox/blob/3e09d4f43bbfb823acd82dc1402dd4db9663c634/_project/analysis/polars-version-matrix/polars-version-matrix-analysis.json) holds the numbers.

## Limits

- **One machine and one data size.** With more memory, 1.44 may finish TPC-DS with its defaults, and query 4 may run normally on 2.1.
- **Only `collect()` queries on Parquet files.** We did not test eager code, CSV files, cloud storage or writing data.
- **Three runs each.** We treat any difference under 10% as noise.
- **We ran query 4 by itself only once per release**, while the machine was busy with other work.
- **Polars expects more.** The Polars team expects the streaming engine to be "easily 5x faster" overall[^2]. We measured 1.6x to 2.1x on these benchmarks.

## Try it on your own workload

You can try the streaming engine before you upgrade. On the version you run today, change one query to:

```python
lf.collect(engine="streaming")
```

Then install 2.x and compare its default with `engine="in-memory"`.

To repeat one of our measurements, install the Polars version you want and run:

```bash
$ POLARS_MAX_THREADS=10 benchbox run --non-interactive --quiet --iterations 1 \
    --platform polars-df --benchmark tpch --scale 10 --tuning notuning \
    --ignore-memory-warnings --platform-option rechunk=false \
    --execution-engine streaming
```

Change `--execution-engine` to `default` or `in-memory`, and `--benchmark` to `tpcds`, `ssb` or `clickbench`.

## Conclusions

If you call `collect()` with the defaults, the upgrade paid off in our tests. Queries took 36% to 53% less time and used less memory, and TPC-DS fit in 16 GiB. Porting took three small fixes.

You gain less if you already use the streaming engine. We measured no gain on the in-memory engine. Check your code for places that depend on row order, because Polars will not warn you.

2.0 and 2.1 performed alike, except for one large `group_by` query that needed far more memory on 2.1. If you run queries like that close to your memory limit, test them on 2.1 first.

---

## References

[^1]: [polars release history](https://pypi.org/project/polars/#history) - PyPI, accessed November 2026
[^2]: [Pre-release of Polars 2.0](https://pola.rs/posts/announcing-polars-2/) - Polars, published September 2, 2026, accessed November 2026
[^3]: [Version 2.0 upgrade guide](https://docs.pola.rs/releases/upgrade/2/) - Polars documentation, accessed November 2026
[^4]: [Polars 2.0.0 release notes](https://github.com/pola-rs/polars/releases/tag/py-2.0.0) - "Enable OOC by default with 80% of available RAM as threshold" (#29741), "Set default OOC disk budget to 64 GB" (#29734) and "Add streaming (out-of-core) sort" (#29657), accessed November 2026
[^5]: [Polars 2.1.0 release notes](https://github.com/pola-rs/polars/releases/tag/py-2.1.0) - "Streaming OOC group-by with shuffles" (#29911) and "Evaluate the streaming window node out of core" (#30282), accessed November 2026
[^6]: [Out-of-core joins](https://github.com/pola-rs/polars/pull/30679) - Polars pull request #30679, merged November 10, 2026, not in a release on November 22, 2026
[^7]: [Streaming OOC group-by with shuffles](https://github.com/pola-rs/polars/pull/29911) - Polars pull request #29911, merged October 21, 2026, accessed November 2026
[^8]: [Semi-join before a union of per-partition scan_iceberg reads uses ~4x the memory of 2.0.0](https://github.com/pola-rs/polars/issues/30608) - Polars issue #30608, open, accessed November 21, 2026
[^9]: [Streaming multiplexer spills a separate copy of each buffered morsel per output port](https://github.com/pola-rs/polars/issues/30981) - Polars issue #30981, open, accessed November 21, 2026
[^10]: [Count pre-aggregates in memory when choosing the number of streaming group-by partitions](https://github.com/pola-rs/polars/pull/30405) - Polars pull request #30405, merged October 29, 2026, accessed November 2026

---

*Questions or feedback? [Open an issue](https://github.com/BenchBox-dev/BenchBox/issues) or join the discussion.*
