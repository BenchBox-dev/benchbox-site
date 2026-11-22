# Outline: Polars 2.x is up to 2x faster. Should you upgrade?

**Reader:** someone running Polars 1.x who wants to know what is different in
2.x and whether the upgrade is worth the effort. They are not a benchmark
author.

**Post type:** BenchBox in Action. State what changed (sourced) and what we
measured (with conditions), then say which readers gain and which should
test first, each with a number or a named condition.

**Target length:** about 1,400 words of prose. Four tables at most.

**Not in this post:** how our runner's memory rules worked. That is
`building-benchbox/outlines/23-memory-checks-that-measured-the-wrong-thing.md`.

## Writing rules for this post

- **Reader first.** Lead each section with what the reader gets or must do.
  No narration of our process: how many times we ran, which run was on which
  day, why a result is or is not "qualified".
- **Short versions.** Write 1.44, 2.0 and 2.1. Give the full versions
  (1.44.2, 2.0.0, 2.1.0) once, in Test setup. Write "2.x" where both agree.
- **State each finding once in the body.** The TL;DR and Conclusions get one
  line each.
- **Short sentences.** One point per sentence. No semicolons joining clauses.
- **Plain words.** Not "matrix", "cell", "qualified", "rounds", "candidate
  mover", "pinned", "spill", "resident memory", "out-of-core", "SF10". Say
  "runs", "written to disk", "peak memory", "scale factor 10". Define swap
  once.
- **Headings** name the section's point. None begins with "What". None is in
  the first person (`STYLE_GUIDE.md`, Headings).
- **No open questions that a search or a small test could answer.** Find the
  answer and cite it, or leave the topic out.
- **One bound per claim**, beside the number or in Limits, not both.
- No em-dashes or en-dashes. Say "took N% less time" and give the speedup
  factor once.

## Evidence sources

- `research/polars-2-1-query-4-2026-11-21.md` (R27-R31: the one query behind
  the 2.1 TPC-DS result, and the upstream Polars reports).
- `research/polars-2-version-matrix-run-2026-11-20.md` (R24-R26: every timing
  and memory figure, from the run on a quiet machine).
- `research/polars-2-upgrade-reader-2026-11-20.md` (R20-R23: migration guide,
  the BenchBox port, query counts).
- Earlier notes (R1-R19) for Polars sources and the superseded runs.
- Core `_project/analysis/polars-version-matrix/` at commit `3e09d4f43b`.

## Title and frontmatter

- Title: "Polars 2.x is up to 2x faster. Should you upgrade?" (50 chars).
  "Up to 2x" is the best case (ClickBench, 2.1x). The range, 1.6x to 2.1x,
  must appear in the first section that gives results.
- Pull quote: the reader gains most if they rely on the defaults, because
  lazy queries now run on the streaming engine.
- tags: polars, dataframe, upgrade, tpc-h, tpc-ds, ssb, clickbench,
  benchmarking.

## Sections

1. **Introduction.** Release dates; the "boring experience" quote; the engine
   default in three sentences; scope in one sentence.
2. **Upgrade or wait.** Four bullets by starting point, each with a number or
   condition.
3. **Breaking changes in 2.0.** Streaming default; row order with the guide's
   warning and a `maintain_order` example; silent conversions now raise;
   removed APIs; writes to disk by default; how to keep the in-memory engine.
4. **Porting 181 queries: three fixes.** The three fixes; no query changed;
   every suite passed the DuckDB comparison.
5. **Speed by starting point.** One table of medians: 1.44 default, 1.44
   streaming, 2.0 default, 2.1 default. Then three short paragraphs: default
   settings (36% to 53%), already on streaming (14% to 29%), staying in
   memory (within about 8%).
6. **Memory on a 16 GiB machine.** Peak memory in one sentence with one
   example. A four-row TPC-DS table. Subsection "One query explains the 2.1
   result": query 4 against the other 102 queries, its shape, the run on its
   own, the rewritten group-by and the two upstream reports.
7. **Row order: test your own code.** Why benchmarks say little; a test the
   reader can run.
8. **Test setup.** Five lines and three links.
9. **Limits.** Five bullets.
10. **Try it on your own workload.** Two commands.
11. **Conclusions.** Three short paragraphs. No open questions.

## Before publishing

1. Check whether a Polars release after 2.1.0 exists. If it does, rerun query
   4 on it and update the memory section.
2. Check the state of Polars issues #30608 and #30981.
3. Re-check the reproduce command against the pinned BenchBox release.
