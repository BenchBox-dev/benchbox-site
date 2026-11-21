# Polars version matrix: the 2026-11-20 rerun on a quiet host

This run supersedes `polars-2-version-matrix-run-2026-11-19.md` as the source
of every timing and memory figure in both posts. Where the two notes
disagree, this one wins. The 2026-11-19 note is kept for the comparison
between runs.

## Why it was rerun

The 2026-11-19 run shared the machine with other agent sessions. The swap
rule reads a host-wide counter, so the 2.1.0 TPC-DS outcome could not be
attributed. This run repeats it on the same BenchBox commit (`82e76af81`),
with the same versions, settings and qualification file, shuffle seed
20261120.

## Sources

| ID | Source | What it supports |
|---|---|---|
| R24 | Core `_project/analysis/polars-version-matrix/findings.md`, `methodology.md`, `polars-version-matrix-comparisons.csv` and `polars-version-matrix-analysis.json`, as refreshed for this run | Every cell, comparison, computed pair, peak RSS and limit below. |
| R25 | Run manifest `~/Developer/benchmark_runs/polars-version-matrix-20261120/matrix-manifest.json` (`complete: true`, 156 records: 131 completed, 10 `resource-policy-exceeded`, 15 `execution-failure`) | Per-run totals, swap, spill, exit codes, load. |
| R26 | Host sentinel log `~/.benchbox/sentinel.log`, 2026-11-20 19:47 to 20:57 local time | Twelve `sent SIGTERM` entries, one per exit-143 run. |

## Host state

- Before the start: no agent CLI process running, 1-minute load 1.9, memory
  pressure normal, heavy-work lock free, mains power. One three-day-old idle
  Ray helper process from another worktree was left alone.
- Not monitored during the run. Load read before each run was 4.3 to 19.4
  (median 13.9), which includes the preceding run's threads.
- 2026-11-21 00:47 to 02:01 UTC. 40 of 52 cells qualified. 58 analyzer
  comparisons, 34 candidate movers.

## Figures for the posts

| Comparison | TPC-H | SSB | ClickBench | TPC-DS |
|---|---|---|---|---|
| 2.0.0 A vs 1.44.2 A | -45.3% | -36.8% | -51.4% | 1.44.2 A not reported |
| 2.1.0 A vs 1.44.2 A | -48.5% | -36.0% | -52.5% | neither reported |
| 1.44.2 C vs 1.44.2 A (computed) | -30.7% | -19.1% | -41.0% | 1.44.2 A not reported |
| Switch share of 2.0.0 A gain (computed) | 68% | 52% | 80% | |
| Switch share of 2.1.0 A gain (computed) | 63% | 53% | 78% | |
| 2.0.0 B vs 1.44.2 A | -7.0% | +0.9% | -1.8% | neither reported |
| 2.1.0 B vs 1.44.2 A | -2.9% | +4.9% | -8.1% | neither reported |
| 2.0.0 C vs 1.44.2 C | -21.9% | -20.2% | -14.2% | -45.4% |
| 2.1.0 C vs 1.44.2 C | -28.8% | -21.2% | -19.0% | 2.1.0 C not reported |
| 2.1.0 A vs 2.0.0 A (computed) | -5.8% | +1.3% | -2.4% | 2.1.0 A not reported |
| 2.1.0 B vs 2.0.0 B (computed) | +4.4% | +4.0% | -6.4% | neither reported |
| 2.1.0 C vs 2.0.0 C (computed) | -8.8% | -1.3% | -5.5% | 2.1.0 C not reported |

All default-engine and streaming comparisons against 1.44.2 are candidate
movers. No in-memory comparison and no 2.1.0-against-2.0.0 comparison is.
Copy cell medians and ranges from R24's tables.

## TPC-DS, 2.0.0 against 2.1.0, run by run (R25)

Every run exited 0 with every query successful.

| Version | Engine | Totals by round (s) | Host swap growth by round (GiB) | Spill by round (GiB) |
|---|---|---|---|---|
| 2.0.0 | default | 29.68, 30.47, 32.83 | 0, 0, 0 | 0, 0, 0 |
| 2.0.0 | streaming | 31.26, 30.40, 33.14 | 0.014, 0, 0 | 0, 0, 0 |
| 2.1.0 | default | 33.69, 34.08, 35.72 | 1.090, 0.249, 1.305 | 0.465, 0.475, 0.465 |
| 2.1.0 | streaming | 33.44, 41.53, 34.49 | 0.289, 4.246, 1.960 | 0.467, 0.470, 0.487 |

What this supports:

- 2.1.0 spilled in every run and the host swapped 0.25 to 4.25 GiB during
  every 2.1.0 run; 2.0.0 never spilled and the host swapped at most
  0.014 GiB during its runs. The same pattern appeared on 2026-11-19 with
  other work
  running. With that work removed it still appears, so it is attributed to
  2.1.0 on this machine by comparison. The counter is still host-wide.
- Every 2.1.0 default run was slower than every 2.0.0 default run; the middle
  rounds differ by 11.8%.
- Four of six 2.1.0 runs passed the 1 GiB limit, so the cells stay "not
  reported". Do not write that 2.1.0 failed TPC-DS, and do not give a 2.1.0
  TPC-DS median.
- Not tested: why. The 2.1.0 release notes list out-of-core changes (R12).

Other TPC-DS outcomes: 1.44.2 streaming qualified at 57.21 (56.48-60.54).
All twelve 1.x default-engine runs were stopped by the host sentinel (R26),
each already 2.45 to 8.81 GiB over the swap counter's start; largest per
release 5.93, 4.83, 4.63 and 8.81 GiB. The runner's own safety monitor
stopped nothing.

## Peak resident memory (R24)

GiB, summed over the process tree, largest of three rounds. Host swap growth
in these cells is at most 0.113 GiB.

| Benchmark | 1.44.2 default | 1.44.2 streaming | 2.0.0 default | 2.1.0 default | 2.0.0 in-memory | 2.1.0 in-memory |
|---|---|---|---|---|---|---|
| TPC-H | 5.772 | 3.151 | 4.620 | 4.586 | 5.804 | 7.200 |
| SSB | 5.061 | 2.227 | 2.227 | 1.927 | 5.673 | 6.233 |
| ClickBench | 2.894 | 2.848 | 2.195 | 2.168 | 2.431 | 3.616 |

These readings are noisy. Against the 2026-11-19 run the same cell moved by
up to 1.85 GiB in this table (TPC-H 1.44.2 streaming) and by up to 2.7 GiB
across all qualified cells. The direction is the same in both runs: on each
benchmark, 2.x default peaks below 1.44.2 default.

## What did not repeat from 2026-11-19

Do not cite these:

- 2.0.0 in memory 4.2% to 15.5% slower than 1.44.2 default. Here: -7.0% to
  +0.9%.
- 2.1.0 in memory faster than 2.0.0 by 16.4% on ClickBench and 18.3% on
  TPC-H. Here: -6.4% and +4.4%.
- The SSB engine-switch share: 51% (2026-10-09), 74% (2026-11-19), 52% here.

The 2.0.0 default-engine headline across the three runs: TPC-H -42.3%,
-41.7%, -45.3%; SSB -38.3%, -36.2%, -36.8%; ClickBench -49.8%, -49.6%,
-51.4%. Within 3.6 percentage points on every benchmark.

## Still open

- Why 2.1.0 needs more memory than 2.0.0 for TPC-DS at SF10, and whether it
  shows on a host with more memory.
- The 1.31.0 streaming TPC-DS crash (exit 138 or 139, 12 to 15 s).
- Swap attributed per process.
