---
blogpost: true
date: [TODO: set on publication]
author: Joe Harris
series: building-benchbox
post_number: 23
type: technical-challenge
tags: benchbox, benchmarking, methodology, memory, macos, polars, tpc-ds
meta_description: "Three memory checks in a benchmark runner each measured something other than the benchmark: host-wide swap, resident memory, and the wrong spill directory."
---

# Three Memory Checks That Measured the Wrong Thing

> Our Polars version runner had rules for memory, swap and disk spill. Each rule produced a number on every run, and each number described something other than the benchmark process.

**TL;DR**: A benchmark runner we wrote for a 16 GiB Mac checked three things on every run: peak memory, swap, and spill to disk. The memory limit never fired, because resident memory on macOS leaves out swapped pages. The swap limit read a counter for the whole machine. The spill check watched a directory Polars does not write to, and reported zero for 120 runs. We fixed the spill check; the other two still limit what we can claim.

---

## Introduction

To compare Polars releases, we wrote a runner that executes TPC-H, TPC-DS, SSB and ClickBench on each release and engine setting, three rounds each. The machine is an Apple M4 with 16 GiB of RAM, and TPC-DS at scale factor 10 does not always fit. So the runner carried rules to keep memory-starved runs out of the results.

The rules looked reasonable and every one produced a clean number. It took a second pass over our own published analysis to see that three of them were measuring something else. This post describes each one, how we found it, and what we changed. The benchmark results themselves are in a separate post on upgrading to Polars 2.x.

## The rules as written

The runner sampled the benchmark's process tree once a second and applied three rules:

| Rule | Threshold | Intended meaning |
|---|---|---|
| Memory limit | 14 GiB peak resident memory | The run used more memory than the machine can give it |
| Swap limit | 1 GiB of swap growth | The run was slowed by swapping, so its timing is not comparable |
| Safety monitor | 6 GiB of swap growth, or sustained critical memory pressure | Stop the run before it makes the machine unusable |

It also recorded how much the engine spilled to disk, so that a run that finished by spilling could be told apart from one that fit in memory.

## Check 1: a memory limit that could not fire

The memory limit compared 14 GiB with peak resident set size (RSS), summed over the process tree.

Across two full runs of the matrix, 276 benchmark runs in all, the largest RSS reading was 8.9 GiB. The limit never fired. Yet in the same runs the machine swapped out as much as 10.4 GiB during a single benchmark run.

RSS counts pages that are resident in physical memory. On macOS, pages that have been swapped out or compressed are not resident, so they drop out of the reading at exactly the moment a process is under memory pressure. The harder a run pressed against the machine's memory, the less of it RSS showed. A 14 GiB RSS limit on a 16 GiB machine was a rule that could not be reached.

We now describe that limit as "never exceeded" and no longer cite it as evidence that a run fit in memory.

## Check 2: a swap limit that measured the machine

The swap limit read the `Swapouts` counter from `vm_stat` before and after each run and discarded the run if the counter grew by more than 1 GiB.

`vm_stat` reports for the whole machine. The counter grows when any process is swapped out, whether or not the benchmark caused it. In practice this rule decided more results than any other:

- In our first run, TPC-H on two Polars releases was discarded by narrow margins: swap growth of 1.36 GiB in one round for one release, and 1.77 and 1.42 GiB in two rounds for another. The same releases completed their other rounds under the limit.
- In our second run, Polars 2.1.0 finished TPC-DS in every round, with every query successful, while the machine swapped 1.0 to 5.9 GiB. All six runs were discarded. Other work was running on the machine at the time.

In the second case we cannot say whether the benchmark or the rest of the machine caused the swap. The rule did its job in one sense: a run that overlaps heavy swapping is not a clean timing, whoever caused it. But the outcome reads as "this release failed the memory rule", and that is a statement about a process, made from a measurement of a host.

We have not fixed this. Our published findings now say which results were decided by the host-wide counter, and we report those runs as "not reported", not as failures.

## Check 3: a spill measurement in the wrong directory

Polars 2.0.0 turned out-of-core execution on by default[^1]. The streaming engine can now write intermediate data to disk when memory runs short. That made spill a result we cared about: did 2.0.0 finish TPC-DS on 16 GiB because it needed less memory, or because it spilled?

The runner set `POLARS_TEMP_DIR` to a fresh directory for each run and sampled that directory's size. Across all 120 runs of the first matrix it read 0.0 GiB. Our analysis said so, and went one step further: it stated that 2.0.0 completing TPC-DS "is not out-of-core spilling".

A zero in every one of 120 runs, across engines that behave differently, should have made us suspicious. When we reviewed the analysis a month later, we read the Polars source for the version we had measured. The default spill directory is `polars-{USER}/spill` under the process temporary directory[^2], and our runner had not set or sampled that directory.

We confirmed it with a small test. We pointed `POLARS_TEMP_DIR` and `TMPDIR` at two different empty directories, set `POLARS_OOC_MEMORY_BUDGET_MB=200` to force spilling, and ran a streaming sort over 12 million rows on Polars 2.0.0:

| Directory | Peak size |
|---|---|
| `POLARS_TEMP_DIR` | 0 bytes |
| `TMPDIR` | 1.12 GB, all under `polars-{USER}/spill` |

Our measurement had been watching an empty directory. We withdrew the claim, then [changed the runner](https://github.com/BenchBox-dev/BenchBox/pull/4204): each run now gets its own `TMPDIR` as well, the recorded spill is the Polars temp directory plus the `polars-*/spill` directory under it, and spill is sampled every second, because spill files exist only while a query runs.

The second matrix gave an answer the first could not. Polars 2.0.0 did not spill on TPC-DS at scale factor 10 on this machine. Polars 2.1.0 spilled 0.47 to 0.57 GiB in every default and streaming round.

## A fourth, smaller one: a stop rule that sampled slowly

The safety monitor was meant to stop a run at 6 GiB of swap growth. It evaluated its conditions on every fifth one-second sample, so "three consecutive critical readings" took about 15 seconds, and a run could swap well past the limit before it was stopped. In the first matrix, runs reached 10.4 GiB.

This did not change any result, because those runs were being stopped either way. It did mean the rule's stated threshold and its real behavior differed, and our methodology page described the threshold.

## What the checks had in common

Each check produced a plausible number on every run, so nothing looked broken:

- The memory reading was always comfortably under its limit.
- The swap reading moved in the direction we expected for heavy workloads.
- The spill reading was a clean zero.

None of them had ever been tested against a case where we knew the answer. The spill check would have failed its first such test: force a spill, and see whether the number moves. We ran that test a month after publishing the analysis. It belongs before any reading from a resource measurement is trusted.

The second lesson is to describe each rule by what it reads. "Swap limit, 1 GiB" invites the reader to assume it is about the benchmark. "Host-wide swap-out growth above 1 GiB during the run" does not.

## What we changed, and what is still open

Changed:

- **Spill** is measured in the directory the engine writes to, with a unit test for the path and a check against real Polars on three releases.
- **The methodology and findings pages** describe each rule as the runner applies it, name the results decided by the host-wide swap counter, and no longer claim that any run did not spill on the strength of the old measurement.
- **Unreported results** are labelled as such, with the reason, instead of being called failures.

Still open:

- **Swap attributed to the benchmark process.** Until we have it, a result discarded by the swap rule says that the machine was swapping, not that the benchmark caused it.
- **A memory reading that includes swapped and compressed pages.** Without it, the memory limit cannot distinguish a run that fit from one that was pushed out to swap.
- **A stop rule that checks every sample.**
- **An idle host.** The second matrix ran while other work was active, and a host-wide counter makes that everyone's problem.

## Conclusions

A resource rule in a benchmark is a measurement too, and it needs the same checking as a timing. Ours gave three wrong answers, and each one looked right: a limit that was never reached, a counter that moved, and a zero.

The fix that mattered was small. Read where the engine writes, force the condition you are trying to detect, and confirm the number moves. If you maintain a benchmark harness on macOS and have a reliable way to attribute swap to one process tree, we would like to hear about it.

---

## References

[^1]: [Polars 2.0.0 release notes](https://github.com/pola-rs/polars/releases/tag/py-2.0.0) - "Enable OOC by default with 80% of available RAM as threshold" (#29741), accessed November 2026
[^2]: [`spill_path.rs` at tag `py-2.0.0`](https://github.com/pola-rs/polars/blob/py-2.0.0/crates/polars-config/src/spill_path.rs) - Polars source, accessed November 2026

---

*Questions or feedback? [Open an issue](https://github.com/BenchBox-dev/BenchBox/issues) or join the discussion.*
