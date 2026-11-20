# Polars version matrix: the 2026-11-19 run with 2.1.0

Companion to `outlines/polars-2-version-matrix.md`. This run supersedes the
2026-10-09 matrix as the source of every timing in the post. Where this note
disagrees with `polars-2-version-matrix-figures-2026-10-09.md` or the two
verification notes, this note wins. Their source descriptions (R1-R15) still
apply.

## Sources

| ID | Source | What it supports |
|---|---|---|
| R16 | Core `_project/analysis/polars-version-matrix/findings.md`, `methodology.md`, `polars-version-matrix-comparisons.csv` and `qualification.json`, as refreshed for this run | Every cell, comparison, computed pair and limit below. |
| R17 | Run manifest `~/Developer/benchmark_runs/polars-version-matrix-20261119/matrix-manifest.json` (`complete: true`, 156 records) and `analysis/polars-version-matrix-analysis.json` beside it | Per-run outcomes, exit codes, swap, spill, load; 52 cells, 41 qualified, 59 comparisons, 28 candidate movers. |
| R18 | Host sentinel log `~/.benchbox/sentinel.log`, 2026-11-19 20:32 to 21:26 local time | Eight `sent SIGTERM` entries that match the eight exit-143 runs to within two seconds. |
| R19 | Core PRs #4204 (spill measured in the engine's spill directory) and #4393 (2.1.0 in the spec, qualification file committed and hash-checked) | What changed in the runner between the two runs. |

## What was run

- Polars 1.31.0, 1.35.2, 1.40.1, 1.44.2, 2.0.0 and 2.1.0. Setup A (default
  engine) on all six; setup B (in-memory) on 2.0.0 and 2.1.0; setup C
  (streaming) on all but 1.35.2. TPC-H, TPC-DS, SSB and ClickBench at SF10.
  Three rounds, shuffled with seed 20261119. 156 runs.
- BenchBox commit `82e76af81`, the final head of core #4393, for every run.
- Host: Apple M4, 10 cores, 16 GiB, macOS 27.0.1, Python 3.12.15.
- 2026-11-20 01:16 to 02:36 UTC.

## Qualification

- All 52 cells passed the cross-surface value gate at the run commit, at the
  gate's own scale factor (0.01 for TPC-H and TPC-DS, 0.1 for SSB and
  ClickBench). The gate checks returned order where the SQL has an ORDER BY
  and compares as a set where it has none, so the row-order question in the
  2026-11-12 note is settled for this run.
- The SF10 DuckDB reference row counts were regenerated from fresh data and
  match the previous reference on all 207 queries.
- TPC-DS query 41 still returns 10 rows on Polars against 12 on DuckDB,
  rechecked on 1.44.2 and 2.1.0.

## Reproducibility across the two runs

The 2.0.0 default-engine headline against 1.44.2, a month and many commits
apart:

| Benchmark | 2026-10-09 | 2026-11-19 |
|---|---|---|
| TPC-H | -42.3% | -41.7% |
| SSB | -38.3% | -36.2% |
| ClickBench | -49.8% | -49.6% |

Individual cell medians moved more than the ratios did. For example, 1.44.2
default SSB went from 5.24 s to 5.61 s. The engine-switch shares are more
sensitive than the headline (see below).

## Figures for the post

All from R16. "Computed" means derived from cell medians and ranges with the
candidate-mover rule; not an analyzer comparison.

| Comparison | TPC-H | SSB | ClickBench | TPC-DS |
|---|---|---|---|---|
| 2.0.0 A vs 1.44.2 A | -41.7% (mover) | -36.2% (mover) | -49.6% (mover) | 1.44.2 A not reported |
| 2.1.0 A vs 1.44.2 A | -45.0% (mover) | -41.0% (mover) | -52.8% (mover) | neither reported |
| 1.44.2 C vs 1.44.2 A (computed) | -28.1% | -26.8% | -42.4% | 1.44.2 A not reported |
| Switch share of 2.0.0 A gain (computed) | 67% | 74% | 86% | |
| Switch share of 2.1.0 A gain (computed) | 62% | 65% | 80% | |
| 2.0.0 B vs 1.44.2 A | +15.5% | +6.3% | +4.2% | neither reported |
| 2.1.0 B vs 1.44.2 A | -5.6% | +2.2% | -12.9% (mover) | neither reported |
| 2.0.0 C vs 1.44.2 C | -21.5% (mover) | -7.8% | -16.1% (mover) | -41.4% (mover) |
| 2.1.0 C vs 1.44.2 C | -27.7% (mover) | -15.9% (mover) | -12.6% (mover) | 2.1.0 C not reported |
| 2.1.0 A vs 2.0.0 A (computed) | -5.6% | -7.5% | -6.5% | 2.1.0 A not reported |
| 2.1.0 B vs 2.0.0 B (computed) | -18.3% (overlap) | -3.9% | -16.4% (mover) | neither reported |
| 2.1.0 C vs 2.0.0 C (computed) | -7.9% | -8.8% | +4.1% | 2.1.0 C not reported |

Cell medians and ranges are in R16's trend tables; copy them from there, not
from this summary.

## TPC-DS on this host

| Cell | Outcome |
|---|---|
| 1.31.0, 1.35.2, 1.40.1, 1.44.2 A | Stopped in every round: by the runner's safety monitor (exit -9) or by the host sentinel (exit 143). Largest swap growth 6.8-7.9 GiB. |
| 2.0.0 A | Qualified: 34.13 (30.91-36.43). Swap at most 0.09 GiB, no spill. |
| 2.0.0 C | Qualified: 36.53 (33.85-44.86). Swap at most 0.28 GiB, no spill. |
| 1.44.2 C | Qualified: 62.27 (59.91-66.54). |
| 2.1.0 A, 2.1.0 C | Finished every round, every query successful, per-run totals 34.7-42.1 s (A) and 36.3-40.7 s (C). Spilled 0.47-0.57 GiB every round. Host swap 1.0-5.9 GiB, so ruled out by the 1 GiB host-wide swap limit. |
| 2.0.0 B, 2.1.0 B, 1.40.1 C | Mixed: ruled out by swap or stopped in at least one round. |
| 1.31.0 C | Crashed every round (exit 138 or 139, 12-15 s), as in the 2026-10-09 run. |

What this supports:

- Spill is now measured where Polars writes it (R19). 2.0.0 did not spill on
  TPC-DS at SF10 on this host; 2.1.0 did, about 0.5 GiB per run.
- 2.1.0 is not shown to be slower on TPC-DS: its unqualified runs have totals
  close to 2.0.0's.
- The swap that ruled 2.1.0 out is host-wide. The run was not on an idle host
  (load before runs 10.8-43.1). Whether 2.1.0 caused the swap is not
  established.

## Things that went differently from the plan

- The host sentinel (kill mode, outside the heavy-work lock) stopped eight
  TPC-DS runs at critical memory pressure (R18). The heavy-work watchdog was
  in warn mode for this run, with owner approval. All eight were in cells
  already failing on memory in other rounds, so no qualified cell was lost.
  The runner records them as `execution-failure`, exit 143.
- The host was not idle. Other agent sessions were active on the machine,
  and two earlier attempts at this run were stopped by SIGTERMs whose sender
  was not found. The sentinel log shows no signal at those times.
- Round 1 ran 9.4% above cell medians on average, not round 3 as in the
  2026-10-09 run. The fastest-round headline (TPC-H -43.0%, SSB -36.0%,
  ClickBench -49.9% for 2.0.0) has the same direction and size.

## Still open

- Whether 2.1.0's TPC-DS swap is the engine's or the host's. A run on a host
  with more memory, or with swap attributed per process, would settle it.
- The 1.31.0 streaming TPC-DS crash is still not investigated.
