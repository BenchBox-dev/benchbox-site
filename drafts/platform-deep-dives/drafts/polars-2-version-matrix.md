---
blogpost: true
date: [TODO: set on publication]
author: Joe Harris
series: platform-deep-dives
type: benchbox-in-action
tags: polars, dataframe, tpc-h, tpc-ds, ssb, clickbench, benchmarking, methodology
meta_description: "Six Polars releases, four benchmarks, three engine settings: how much of a 2.x upgrade gain is the new streaming default, and what our memory rules measured."
---

# Polars 2.x vs 1.x: Name the Engine Before You Compare

> When a major version changes the default engine, an upgrade benchmark measures two things at once. We separated them across six Polars releases, then found that two of our own memory measurements needed the same care.

**TL;DR**: With each version's defaults, Polars 2.0.0 and 2.1.0 finished TPC-H, SSB and ClickBench 36% to 53% faster than 1.44.2 at scale factor 10 on a 16 GiB Apple M4. Switching 1.44.2 to the streaming engine already gave 62% to 86% of that gain (computed from our medians), and on the same engine 2.1.0 and 2.0.0 were within 9% of each other except in memory, where 2.1.0 was up to 18% faster. On TPC-DS, our host's memory rules decided which runs counted, and one of them reads swap for the whole machine, which is why 2.1.0 has no TPC-DS figure in our tables.

---

## Introduction

An upgrade benchmark answers the question you asked, which is not always the one you meant. You install the new version, rerun the same script and compare. If the new version also changed a default, the comparison now covers two changes.

Polars 2.0 is a clear case. Its pre-release announcement says: "Calling `collect` on a `LazyFrame` will now default to the streaming engine"[^1]. The collect engine is the executor that runs a lazy query plan when you call `collect()`. The 1.x releases we tested ran a bare `collect()` on the in-memory engine and accepted `engine="streaming"` as an option, so a script with a bare `collect()` runs on a different engine after the upgrade.

A single "2.x vs 1.x" number therefore mixes two questions. How much faster is the new default? And how much faster did each engine get?

To separate them, we ran six Polars releases, from 1.31.0 to 2.1.0, on four benchmarks under three engine settings, three rounds each. That is 156 runs through BenchBox's Polars DataFrame platform (`polars-df`) on one machine. Polars 2.0.0 was released on 2026-10-06 and 2.1.0 on 2026-10-25[^2]; 2.1.0 was the current release when we ran the matrix on 2026-11-19.

This post covers what the matrix showed, and a second lesson we did not plan for. On a 16 GiB machine, our memory rules decided which TPC-DS results counted, and two of our measurements were not measuring what we thought.

## What we ran

- **Hardware**: Apple M4, 10 cores, 16 GiB RAM, macOS 27.0.1
- **Software**: Python 3.12.15; Polars 1.31.0, 1.35.2, 1.40.1, 1.44.2, 2.0.0 and 2.1.0; BenchBox at commit `82e76af81` for every run
- **Benchmarks**: TPC-H, TPC-DS, SSB and ClickBench at scale factor 10, read from Parquet
- **Configuration**: `POLARS_MAX_THREADS=10`, `rechunk=false`, no tuning
- **Methodology**: one warm-up pass and one measured pass per query; three rounds, with the order of cells shuffled in each round (seed 20261119)
- **Limitations**: one host, which was not idle during the run; see [What these numbers do not show](#what-these-numbers-do-not-show)

Scale factor (SF) is how a benchmark sizes its data. For TPC-H, SF10 is about 10 GB of raw data.

Each run used one of three engine settings:

| Setup | BenchBox option | Engine | Versions |
|---|---|---|---|
| A | `--execution-engine default` | What a bare `collect()` uses: in-memory on 1.x, streaming on 2.x | All six |
| B | `--execution-engine in-memory` | In-memory | 2.0.0, 2.1.0 |
| C | `--execution-engine streaming` | Streaming | All except 1.35.2 |

A cell is one version on one setup and one benchmark, which gives 52 cells. A cell total is the sum of the measured per-query wall times, Parquet reads included. We report each cell in seconds as the median of three rounds, with the minimum and maximum in parentheses.

We call a difference a **candidate mover** when the median changes by at least 10% and the min-max ranges of the two cells do not overlap. Three rounds cannot support a significance test, so a candidate mover is a lead to follow up. We also made many comparisons: our analyzer made 59, of which 28 are candidate movers, and we computed 12 more from the cell medians for this post.

Before the timed runs, every cell passed a value-level check against DuckDB SQL results at a small scale factor (0.01 for TPC-H and TPC-DS, 0.1 for SSB and ClickBench). The check compares returned order where the SQL has an `ORDER BY` and compares rows as a set where it has none. At SF10, each run had to match DuckDB's row count on every query.

Two notes on version selection. Polars 1.35.2 runs on the default engine only: in an earlier probe at SF 0.01, its streaming TPC-DS results had NULLs where the DuckDB SQL results had values (queries 5, 14, 27 and 67), in two separate runs. We have not determined whether Polars or BenchBox's DataFrame query code is the cause, so we left that cell out. We also dropped 1.0.0, 1.12.0 and 1.22.0 after that probe: 1.0.0 has no `engine` argument and panicked, 1.12.0 returned a mismatching TPC-DS query 51, and 1.22.0 failed TPC-DS queries 51 and 87.

## Default settings: 2.x finished 36% to 53% faster than 1.44.2

This is the comparison most upgrade tests make: the same script, a bare `collect()`, old version against new.

| Benchmark | 1.44.2 | 2.0.0 | 2.1.0 | 2.0.0 change | 2.1.0 change |
|---|---|---|---|---|---|
| TPC-H | 11.20 (10.64-13.28) | 6.53 (6.06-7.59) | 6.16 (6.04-6.73) | -41.7% | -45.0% |
| SSB | 5.61 (5.15-7.07) | 3.58 (3.30-4.08) | 3.31 (3.31-3.94) | -36.2% | -41.0% |
| ClickBench | 4.58 (4.34-4.67) | 2.31 (2.17-2.33) | 2.16 (2.02-2.37) | -49.6% | -52.8% |
| TPC-DS | not reported | 34.13 (30.91-36.43) | not reported | | |

All six differences are candidate movers. The TPC-DS gaps are explained in [the TPC-DS section](#what-decided-tpc-ds-memory-rules-on-a-16-gib-host).

The 2.0.0 ratios reproduced. In our first run of this matrix a month earlier, on an older BenchBox commit, they were -42.3%, -38.3% and -49.8%.

One cross-check supports the announcement's statement about the default. On every benchmark where both cells qualified, a 2.x version's default-engine median is within about 7% of its streaming median. The largest gap is 2.0.0 on TPC-DS, 34.13 s against 36.53 s.

## How much of the gain is the engine switch

The direct way to measure the switch is to run one version on both engines. Polars 1.44.2 accepts `engine="streaming"`, so we compared its default (in-memory) cells with its streaming cells.

| Benchmark | 1.44.2 in-memory | 1.44.2 streaming | Change | Share of 2.0.0 gain | Share of 2.1.0 gain |
|---|---|---|---|---|---|
| TPC-H | 11.20 (10.64-13.28) | 8.06 (8.02-8.28) | -28.1% | 67% | 62% |
| SSB | 5.61 (5.15-7.07) | 4.11 (4.05-4.69) | -26.8% | 74% | 65% |
| ClickBench | 4.58 (4.34-4.67) | 2.64 (2.57-3.09) | -42.4% | 86% | 80% |

The share columns divide the time saved by switching engine on 1.44.2 by the time saved by moving from 1.44.2 to 2.x at default settings. We computed these three comparisons from the cell medians; they are not among the analyzer's 59. Each pair has non-overlapping ranges and a change above 10%, so all three meet the candidate-mover rule.

The shares are less stable than the headline. In our first run the 2.0.0 shares were 76%, 51% and 86%. SSB moved the most, because its 1.44.2 medians shifted between the two runs. We read the result as "about two-thirds to most", not as one number.

On these benchmarks, then, a 1.44.2 user who had already named the streaming engine had most of what the 2.x default delivers.

The control runs the other way: hold the engine at in-memory and change the version.

| Benchmark | 1.44.2 in-memory | 2.0.0 in-memory | 2.1.0 in-memory |
|---|---|---|---|
| TPC-H | 11.20 (10.64-13.28) | 12.94 (11.47-13.28), +15.5% | 10.58 (10.21-12.71), -5.6% |
| SSB | 5.61 (5.15-7.07) | 5.97 (5.56-7.60), +6.3% | 5.73 (5.18-6.90), +2.2% |
| ClickBench | 4.58 (4.34-4.67) | 4.77 (4.54-4.99), +4.2% | 3.99 (3.90-4.30), -12.9% |

With the engine held in memory, 2.0.0's gain is gone: its medians are 4% to 16% above 1.44.2's, with overlapping ranges. 2.1.0 is within 6% on TPC-H and SSB and 12.9% faster on ClickBench, the one candidate mover in this table.

Set the engine explicitly in any before-and-after upgrade test. In Polars, pass `engine="streaming"` or `engine="in-memory"` to `collect()`, or call `pl.Config.set_engine_affinity`[^1]. In BenchBox, pass `--execution-engine`.

## Same engine, newer version

Holding the engine at streaming shows how much the streaming engine itself changed.

| Benchmark | 1.44.2 streaming | 2.0.0 streaming | 2.1.0 streaming |
|---|---|---|---|
| TPC-H | 8.06 (8.02-8.28) | 6.32 (6.12-7.61), -21.5% | 5.83 (5.75-6.55), -27.7% |
| SSB | 4.11 (4.05-4.69) | 3.79 (3.31-4.02), -7.8% | 3.45 (3.45-3.93), -15.9% |
| ClickBench | 2.64 (2.57-3.09) | 2.21 (2.20-2.44), -16.1% | 2.30 (2.12-2.39), -12.6% |
| TPC-DS | 62.27 (59.91-66.54) | 36.53 (33.85-44.86), -41.4% | not reported |

Six of these seven differences are candidate movers. The exception is 2.0.0 on SSB, where the change is below 10%. TPC-DS shows the largest change, and its 2.0.0 cell has the widest range in the table.

Between 2.0.0 and 2.1.0, the differences on the default and streaming engines are small. The 2.1.0 medians range from 8.8% lower to 4.1% higher than 2.0.0's, and every pair of ranges overlaps, so none is a candidate mover. In memory, 2.1.0 is faster on all three benchmarks: TPC-H by 18.3% (the ranges overlap), SSB by 3.9% and ClickBench by 16.4% (a candidate mover). We computed these nine comparisons from the cell medians.

Within 1.x, the streaming engine's largest step on TPC-H came between 1.31.0 and 1.40.1: 11.02 s (11.01-12.79) down to 7.91 s (7.54-9.61), a 28.2% drop. From 1.40.1 to 1.44.2 the streaming medians are within 6% of each other on TPC-H, SSB and ClickBench.

## What decided TPC-DS: memory rules on a 16 GiB host

TPC-DS at SF10 is the heaviest workload in the matrix. On this machine memory decided its results, not speed: 3 of the 13 TPC-DS cells qualified.

| Cells | What happened |
|---|---|
| 1.31.0, 1.35.2, 1.40.1, 1.44.2 default | Stopped in every round; host swap growth reached 6.8-7.9 GiB per cell |
| 2.0.0 default | Qualified: 34.13 (30.91-36.43); swap growth at most 0.09 GiB; no spill |
| 2.0.0 streaming | Qualified: 36.53 (33.85-44.86); swap growth at most 0.28 GiB; no spill |
| 1.44.2 streaming | Qualified: 62.27 (59.91-66.54) |
| 2.1.0 default | Finished every round with every query successful, 34.67-42.13 s per run; ruled out by the swap limit |
| 2.1.0 streaming | Finished every round with every query successful, 36.26-40.74 s per run; ruled out by the swap limit |
| 2.0.0 in-memory, 2.1.0 in-memory, 1.40.1 streaming | One round completed; the others were ruled out or stopped |
| 1.31.0 streaming | Crashed 12-15 s into every round (exit code 138 or 139); not investigated |

### How the rules behaved

Four guards applied. Only the first and last stop a run; the other two rule a run out after it ends.

- **Safety monitor.** The runner stops a run when host swap growth passes 6 GiB or memory pressure stays critical for three consecutive checks. It checks every fifth one-second sample, so a run can pass the limit before it is stopped.
- **Swap limit, 1 GiB.** Applied after a run ends. It reads the `Swapouts` counter from `vm_stat`, which counts the whole machine, so swap caused by any process counts against the run.
- **Memory limit, 14 GiB.** Applied after a run ends, to peak resident set size (RSS) summed over the process tree. RSS on macOS leaves out swapped and compressed pages. The largest reading was 8.9 GiB, so this limit never applied.
- **Host sentinel.** Our development machine runs a separate guard that sends SIGTERM to the largest BenchBox process when memory pressure is critical. It stopped eight TPC-DS runs. Each had already passed the 1 GiB swap limit (1.98-7.50 GiB) and the counter only grows, so no stop changed which cells qualified.

The swap limit also ruled out one cell outside TPC-DS: 1.31.0 on TPC-H with the default engine, at 2.29 and 1.59 GiB in two of its rounds.

### Measuring spill in the right directory

Polars 2.0.0 turns out-of-core execution on by default, with a threshold of 80% of available RAM and a 64 GB disk budget[^3]. Out-of-core execution lets the engine write intermediate data to disk (spill) when memory runs short.

Our first run of this matrix recorded zero spill for all 120 runs, and our analysis notes concluded that no run had spilled. The runner had pointed `POLARS_TEMP_DIR` at a per-run directory and measured that directory. Polars 2.0.0 writes spill files elsewhere: to `polars-{USER}/spill` under the process temporary directory[^4]. When we set the two directories apart and ran a streaming sort under a small memory budget, 1.12 GB appeared under `TMPDIR` and nothing under `POLARS_TEMP_DIR`. We [changed the runner](https://github.com/BenchBox-dev/BenchBox/pull/4204) to give each run its own temporary directory and to measure the spill directory inside it.

With that fixed, 2.0.0 did not spill on TPC-DS at SF10 on this host, and 2.1.0 spilled 0.47-0.57 GiB in every default and streaming round. The 2.1.0 release notes list more out-of-core work, including an out-of-core group-by[^5]. We did not test whether that accounts for the difference.

### What we can say about TPC-DS

- 2.0.0's default and streaming engines finished TPC-DS at SF10 in all three rounds without spilling. No 1.x default-engine run finished.
- 2.1.0 also finished every round, with per-run totals close to 2.0.0's. The host swapped 1.0-5.9 GiB while those runs were active, our rule counts host swap against the run, and other work was running on the machine. We cannot say whether 2.1.0 caused that swap, so we report the cells as not qualified and draw no conclusion about 2.1.0's TPC-DS speed or memory use.
- These outcomes describe this host and these rules. A machine with more memory may produce different ones.

A TPC-DS result we could stand behind on a small machine needs four things: swap attributed to the benchmark process, memory readings that include swapped pages, a safety check on every sample, and an idle host.

## What these numbers do not show

- **Correctness at SF10.** Values were checked at small scale factors only. At SF10 we checked row counts. TPC-DS query 41 returns 10 rows on Polars and 12 on DuckDB on every version; it stays in the totals above, and leaving it out changes a cell median by 0.021 s at most.
- **Engine fallback.** We recorded the engine each run requested. We did not observe whether streaming operators fell back to in-memory execution.
- **A comparison with DuckDB.** Polars timings here include Parquet reads in every query. BenchBox's DuckDB version matrix reads a pre-loaded database, so the two sets of timings do not compare.
- **An idle host.** The 1-minute load average before each run was 10.8 to 43.1 (median 16.8), partly from the preceding run's threads and partly from other work. Memory pressure was normal before every run.
- **Round effects.** Round 1 ran 9.4% above cell medians on average. Comparing each cell's fastest round gives the same direction and similar sizes: for 2.0.0 against 1.44.2, TPC-H -43.0%, SSB -36.0% and ClickBench -49.9%.
- **Per-query movers.** Every comparison here is a cell total.
- **The 5x expectation.** The Polars announcement says: "In aggregate we expect the streaming engine to be easily 5x faster."[^1] Four benchmarks at one scale factor on one 16 GiB machine can neither confirm nor contradict an aggregate expectation.

## Reproduce it

Install the Polars version you want to test, then run one cell. This is the command the matrix runs for TPC-H on the streaming engine:

```bash
$ POLARS_MAX_THREADS=10 benchbox run --non-interactive --quiet --iterations 1 \
    --platform polars-df --benchmark tpch --scale 10 --tuning notuning \
    --ignore-memory-warnings --platform-option rechunk=false \
    --execution-engine streaming
```

Change `--execution-engine` to `default` or `in-memory` for the other setups.

To see the full plan, run the matrix runner from a BenchBox checkout as a dry run:

```bash
$ uv run --no-sync -- python scripts/run_polars_version_matrix.py \
    --output-dir ~/benchmark_runs/polars-matrix \
    --shuffle-seed 20261119 \
    --dry-run

# 3 rounds x 52 cells = 156 invocations (shuffle seed 20261119, first round 1)
...
round 1 position 2/52 tpch/2.0.0/A: install polars==2.0.0; $ uv run --no-sync -- benchbox run ...
```

A full run also needs `--qualification` pointing at the committed `qualification.json`, whose hash the runner checks. On a 16 GiB machine, expect TPC-DS cells to hit the memory rules.

The evidence for this post is in the BenchBox repository, pinned to the commit that published it:

- [Findings](https://github.com/BenchBox-dev/BenchBox/blob/9d78af081b861c064f60b1a8d6965d21ae8d34db/_project/analysis/polars-version-matrix/findings.md): every cell, comparison and unqualified run
- [Methodology](https://github.com/BenchBox-dev/BenchBox/blob/9d78af081b861c064f60b1a8d6965d21ae8d34db/_project/analysis/polars-version-matrix/methodology.md): rules, controls and limits
- [Comparisons CSV](https://github.com/BenchBox-dev/BenchBox/blob/9d78af081b861c064f60b1a8d6965d21ae8d34db/_project/analysis/polars-version-matrix/polars-version-matrix-comparisons.csv), [analysis JSON](https://github.com/BenchBox-dev/BenchBox/blob/9d78af081b861c064f60b1a8d6965d21ae8d34db/_project/analysis/polars-version-matrix/polars-version-matrix-analysis.json) and [qualification file](https://github.com/BenchBox-dev/BenchBox/blob/9d78af081b861c064f60b1a8d6965d21ae8d34db/_project/analysis/polars-version-matrix/qualification.json)

Raw result bundles and the run manifest are not published.

## Conclusions

Three checks came out of this work, and they apply to any upgrade benchmark:

1. **Name the engine.** When a version changes a default, run the old version on the new default and the new version on the old one.
2. **Check what a memory limit reads.** Ours read swap for the whole machine and RSS without swapped pages.
3. **Check where the engine writes.** Our spill measurement watched a directory Polars does not spill to.

On the measurements themselves: Polars 2.0.0 and 2.1.0 were faster than 1.44.2 in every default-settings and streaming comparison where both cells qualified. How large the gain looks depends on what is held fixed. Against 1.x defaults it is 36% to 53%, and about two-thirds to most of that was already available by switching engine on 1.44.2. Between 2.0.0 and 2.1.0 the differences are small except in memory.

Two questions are open. We do not know whether 2.1.0 or the rest of our machine caused the swap that ruled out its TPC-DS cells; a run on a host with more memory would settle it. And we have not investigated why 1.31.0 crashes on streaming TPC-DS. If you run the matrix on other hardware, or know the cause of that crash, we would like to hear about it.

---

## References

[^1]: [Pre-release of Polars 2.0](https://pola.rs/posts/announcing-polars-2/) - Polars, published September 2, 2026, accessed November 2026
[^2]: [polars release history](https://pypi.org/project/polars/#history) - PyPI, accessed November 2026
[^3]: [Polars 2.0.0 release notes](https://github.com/pola-rs/polars/releases/tag/py-2.0.0) - "Enable OOC by default with 80% of available RAM as threshold" (#29741) and "Set default OOC disk budget to 64 GB" (#29734), accessed November 2026
[^4]: [`spill_path.rs` at tag `py-2.0.0`](https://github.com/pola-rs/polars/blob/py-2.0.0/crates/polars-config/src/spill_path.rs) - Polars source, accessed November 2026
[^5]: [Polars 2.1.0 release notes](https://github.com/pola-rs/polars/releases/tag/py-2.1.0) - "Streaming OOC group-by with shuffles" (#29911), accessed November 2026

---

*Questions or feedback? [Open an issue](https://github.com/BenchBox-dev/BenchBox/issues) or join the discussion.*
