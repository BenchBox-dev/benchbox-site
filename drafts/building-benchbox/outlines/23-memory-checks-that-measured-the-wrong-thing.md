# Outline: Three Memory Checks That Measured the Wrong Thing

**Reader:** someone who writes or maintains benchmark harnesses, or who reads
benchmark methodology critically.

**Post type:** Technical challenge. A problem in our own tooling, how we
found it, what we changed and what is still open.

**Target length:** 1,200-1,500 words.

**Thesis:** a resource rule in a benchmark is itself a measurement. Three of
ours produced plausible numbers on every run while measuring something other
than the benchmark process.

**Split from:** the Polars 2.x upgrade post
(`platform-deep-dives/outlines/polars-2-version-matrix.md`), which keeps the
benchmark results. This post carries no Polars performance claims.

**Evidence sources** (all under `platform-deep-dives/research/`):
- `polars-2-version-matrix-verification-2026-10-17.md` (R1, R3: how the
  rules were applied in the first run; RSS and swap maxima).
- `polars-2-version-matrix-reverification-2026-11-12.md` (R9-R11: the
  out-of-core default, the spill directory, the two-directory test).
- `polars-2-version-matrix-run-2026-11-19.md` (R16-R19: the second run, on a
  busy host) and `polars-2-version-matrix-run-2026-11-20.md` (R24-R26: the
  third run, on a quiet host; spill as measured after the fix).
- Core `_project/analysis/polars-version-matrix/methodology.md` and PRs
  #4168 (claims corrected) and #4204 (spill measurement fixed).

## Sections

1. **Introduction.** The runner, the 16 GiB machine, why it had memory rules.
2. **The rules as written.** Table: memory limit, swap limit, safety
   monitor, plus the spill recording.
3. **Check 1: a memory limit that could not fire.** 14 GiB RSS limit; largest
   reading 8.9 GiB across 432 runs while the host swapped up to 10.4 GiB;
   why RSS on macOS falls under pressure.
4. **Check 2: a swap limit that measured the machine.** `vm_stat` is
   host-wide; the narrow TPC-H discards in the first run; 2.1.0 on TPC-DS in
   the second; the full rerun on a quiet host that it took to attribute the
   swap. Rule not fixed; how we report it now.
5. **Check 3: a spill measurement in the wrong directory.** The out-of-core
   default; zero for 120 runs; the claim we published; the source reading;
   the two-directory test (0 bytes against 1.12 GB); the fix; what the later
   runs then showed.
6. **A fourth, smaller one.** The stop rule evaluated every fifth sample.
7. **What the checks had in common.** Plausible numbers; never tested
   against a known answer; name a rule by what it reads.
8. **What we changed, and what is still open.** State open items as needs,
   not as a roadmap.
9. **Conclusions.** Invite a method for per-process swap attribution on
   macOS.

## Before publishing

1. Decide whether to publish after the upgrade post, so this post can link
   to it.
2. Confirm the open items are still open; update if swap attribution or the
   sampling interval has changed.
