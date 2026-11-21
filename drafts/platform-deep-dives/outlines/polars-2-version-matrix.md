# Outline: Upgrading to Polars 2.x: What Changed, What We Measured

**Reader:** someone running Polars 1.x who wants to know what is different in
2.x and whether the upgrade is worth the effort. They are not a benchmark
author. They want the changes that touch their code and results, the cost of
porting, and the return in time and memory for a situation like theirs.

**Post type:** BenchBox in Action. Neutral on the platform: report what
changed (sourced) and what we measured (with conditions), by situation. No
"you should upgrade"; direct imperatives only for concrete steps.

**Target length:** 2,000-2,500 words of prose.

**Not in this post:** how our runner's memory rules worked and where they
measured the wrong thing. That is its own post:
`building-benchbox/outlines/23-memory-checks-that-measured-the-wrong-thing.md`.
This post keeps only the sentence needed to explain why 2.1.0 has no TPC-DS
figure.

**Evidence sources:**
- `research/polars-2-upgrade-reader-2026-11-20.md` (R20-R23: migration guide,
  what the BenchBox port cost, peak memory per benchmark, reference query
  counts).
- `research/polars-2-version-matrix-run-2026-11-20.md` (R24-R26: every
  timing, memory figure and TPC-DS outcome, from the rerun on a quiet host).
- `research/polars-2-version-matrix-run-2026-11-19.md` (R16-R19: the
  earlier run on a busy host; for the comparison between runs only).
- `research/polars-2-version-matrix-reverification-2026-11-12.md` and
  `-verification-2026-10-17.md` (R1-R15: Polars sources, resource rules).
- Core `_project/analysis/polars-version-matrix/`, pinned in the draft to
  the commit that published the 2026-11-20 results.

Every timing comes from the 2026-11-20 run. Every statement about what Polars
changed cites the announcement, the migration guide or the release notes.

**Voice reminders:** "we"; neutral on platforms; median with min-max range in
tables; say "took N% less time", not "N% faster", and give the speedup
factor once; no em-dashes or en-dashes; define scale factor and spill on
first use; no internal vocabulary (setups A/B/C, "cell", "candidate mover")
before the results.

## Title and frontmatter

- Title: "Upgrading to Polars 2.x: What Changed, What We Measured" (55 chars).
- tags: polars, dataframe, upgrade, tpc-h, tpc-ds, ssb, clickbench,
  benchmarking.
- TL;DR: what changes (streaming default, row order, removals); the port
  took three small fixes; 36% to 53% less time at default settings; 2.0.0
  finished TPC-DS on 16 GiB where no 1.x default run did; 14% to 29% if
  already on streaming; in memory, within 8% of 1.44.2; on TPC-DS, 2.1.0
  used more memory than 2.0.0 and ran about 12% slower.

## 1. Introduction

- The reader's two questions: what will it change, what do I get back.
- Polars' own framing: a release about defaults ("boring experience" quote).
- What we did and the scope bound, stated once: lazy analytical queries over
  Parquet on one 16 GiB laptop.

## 2. What changed in 2.0

- Lazy queries run on the streaming engine; `pl.sql(eager=True)` too; eager
  `DataFrame` operations are unaffected (migration guide).
- Row order no longer guaranteed through join, group_by, unpivot; the guide's
  "may silently impact the results" warning; `maintain_order` example.
- Stricter: `is_in` coercion, horizontal concat, string-to-date casts.
- Removed deprecated APIs and the two new exception types.
- Out-of-core on by default in 2.0.0; more out-of-core work in 2.1.0.
- How to keep the in-memory engine (three ways).

## 3. What the port cost us

- 181 queries (22, 103, 13, 43). Three fixes, none in a query: reader
  `rechunk=`, the renamed and inverted CSV keyword, string-to-date casts.
- Supporting 1.35.2 and 2.x in one codebase: signature dispatch.
- All four suites passed the value comparison on 2.x; what that check does
  and does not show about row order.

## 4. What we measured, by situation

- Lead with the situation table (five rows).
- Bare `collect()`: table, 36% to 53% less time, 1.6x to 2.1x.
- Already on streaming in 1.x: the 1.44.2 engine-switch table (52% to 80% of
  the gain), then 2.x streaming against 1.44.2 streaming.
- Staying in memory: table; say that we measured pinned lazy queries, not
  the eager API.
- 2.0.0 or 2.1.0: two sentences.

## 5. Memory on a 16 GiB machine

- Peak resident memory table (R22), with the swap condition that makes the
  readings comparable.
- TPC-DS: no 1.x default run finished; 2.0.0 did, without swapping or
  spilling; 1.44.2 streaming also finished.
- 2.1.0 on TPC-DS: every run finished, spilled about 0.47 GiB and ran while
  the host swapped; 2.0.0 did not. Give the round-by-round table. Explain in
  plain words why there is no qualified median (four of six runs over the
  1 GiB swap limit) and that the pattern held on a quiet host. Do not write
  that it failed, and do not give a 2.1.0 TPC-DS median.

## 6. What we could not measure: row order

- Why benchmark queries say little about incidental order.
- A concrete test the reader can run on their own code.

## 7. How we measured

- Test environment list; three rounds; when a result is reported; the
  follow-up threshold in one sentence; which figures are computed.
- Links to findings, methodology and analysis JSON, pinned to the core commit.

## 8. Limits

- One machine and scale; analytical queries over Parquet; busy host and the
  month-apart reproduction; row counts at SF10 and query 41; requested
  engine; the 5x expectation against our 1.6x to 2.1x.

## 9. Try it on your own workload

- Name the engine on the version you run today; then compare on 2.x.
- The `benchbox run` command for one benchmark and engine.

## 10. Conclusions

- What changes; what it cost us; what it returned; how much depends on where
  you start. Two open questions and an invitation.

## Before publishing

1. Re-verify that 2.1.0 is still the current release, and re-read the
   migration guide for changes since 2026-11-20.
2. Re-check the reproduce command against the pinned release.
3. Optional: peak-memory figures for TPC-DS need a host with more memory or
   swap attributed per process.
