---
tags: [contributor]
---

<!-- Copyright 2026 Joe Harris / BenchBox Project. Licensed under the MIT License. -->

# Results embeds

Documentation and blog pages can show a benchmark result from the Results
Explorer next to the text that discusses it. There are two kinds, and each
one tells the reader which of the two they are looking at.

- **Cited result.** One result, fixed to a named snapshot. The page keeps the
  values it was published with and shows the snapshot's identity and date.
  Use it in analysis that must not change after publication.
- **Current results.** One or more results, read from the snapshot that the
  site serves right now and labelled **Live**. Use it for pages that should
  stay up to date.

Both use the Explorer's own code for metric names, number formats, the
primary metric of each benchmark and the visibility, ranking and withdrawal
rules, so a value in an embed is the value the Explorer shows for the same
snapshot.

## Writing an embed

An embed is a fenced code block whose language is `benchbox-result`, holding
`key: value` lines. It is plain GitHub-flavoured Markdown: GitHub shows the
block as code, which reads as the citation record, and the site replaces it
with the embed. The MyST guard has nothing to object to, because the fence
language is not a directive.

### Cited result

Do not type the values by hand. Print the block for a result in the current
snapshot with the cite command and paste it into the page:

```bash
npm run results:cite -w website -- tpch-duckdb-sf1.0-20261007-83a01707
```

The command prints the block below. It fails when the result is not in the
current snapshot, because a withdrawn result cannot be cited.

````markdown
```benchbox-result
kind: cited
result: "tpch-duckdb-sf1.0-20261007-83a01707"
snapshot: "0e189624e6712c0e96cac56022b6530ec99648e2a1ffa0aade638652490822ea"
snapshot_date: "2026-11-06"
platform: "DuckDB"
benchmark: "TPC-H"
scale: "SF 1"
run_date: "2026-10-07"
metric: "Throughput@Size"
direction: "higher is better"
value: "297,653"
```
````

| Key | Meaning |
|---|---|
| `result` | The Explorer result id. |
| `snapshot` | The sha256 of the Results Explorer snapshot the values came from. |
| `snapshot_date` | The date of the bundle that carried that snapshot. |
| `platform`, `benchmark`, `scale`, `run_date` | The identity of the run, as the Explorer shows it. |
| `metric`, `direction`, `value` | The primary metric of the run, as the Explorer formats it. |

The build fails with the file and line when a key is missing or unknown, the
snapshot is not 64 hex characters, or a date is not `YYYY-MM-DD`.

### Current results

List the result ids. Each one is shown as a row, in the order written, with
at most ten results in one block.

````markdown
```benchbox-result
kind: current
results:
  - tpch-duckdb-sf1.0-20261007-83a01707
  - tpch-spark-sf1.0-20261007-9c57f2ae
```
````

## What the reader sees

The page carries the cited values in its HTML, so they are readable without
JavaScript and are found by site search. The Explorer's code and the DuckDB
engine are not fetched until the embed scrolls into view. A page without an
embed fetches nothing from the Explorer.

Once an embed is in view, it reads the current snapshot and reports:

- **Published.** A cited result says whether the current snapshot reports the
  same value. It never replaces the cited value; when the current value
  differs, it says so next to the cited one. A current result shows the
  platform, benchmark, run date, primary metric and whether the run is
  ranked, with the Explorer's reason when it is not.
- **Withdrawn.** A result that the current snapshot no longer contains, or
  whose visibility is not public, is shown as withdrawn. The values are
  removed and the id, and for a cited result the snapshot identity, stay.
  A withdrawn result is never dropped from the page and never shown as if it
  were still published.
- **Not readable.** When the snapshot cannot be loaded, a cited result keeps
  its values and says it could not be checked. A current result says so and
  points to the Results Explorer.

## Examples

A cited result, from the snapshot of the bundle that was current when this
page was written:

```benchbox-result
kind: cited
result: "tpch-duckdb-sf1.0-20261007-83a01707"
snapshot: "0e189624e6712c0e96cac56022b6530ec99648e2a1ffa0aade638652490822ea"
snapshot_date: "2026-11-06"
platform: "DuckDB"
benchmark: "TPC-H"
scale: "SF 1"
run_date: "2026-10-07"
metric: "Throughput@Size"
direction: "higher is better"
value: "297,653"
```

Current results, where the last id is not in the snapshot and so shows as
withdrawn:

```benchbox-result
kind: current
results:
  - tpch-duckdb-sf1.0-20261007-83a01707
  - tpch-spark-sf1.0-20261007-9c57f2ae
  - tpch-duckdb-sf1.0-20200101-00000000
```
