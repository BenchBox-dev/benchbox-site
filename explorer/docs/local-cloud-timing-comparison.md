# Comparing Local and Cloud Runs: Round-Trip Latency

How the Explorer should compare an in-process run (DuckDB, Polars) with a
networked run (Snowflake, BigQuery), and whether to leave client
round-trip time out of the comparison.

**Decision in brief:**

- End-to-end time stays the only default, on every page.
- Users can choose to leave out the client round trip that BenchBox
  measured. This view is labeled *round trip removed (estimated)* and is
  shown next to end-to-end time, never in place of it.
- Core captures, keeps and publishes the timings each platform reports
  for every query: the raw fields as returned, plus a derived total.
  Run pages and downloads show them whether or not a comparison uses
  them.
- Comparisons can also use the platform's own time as a further clock,
  labeled *platform-reported*.
- Nothing switches by default.
- Before any of this ships, fix the timers in core so they stop counting
  work that is not the query.

## Problem

Every published query time is the client's end-to-end wall clock. That
means different things on each side of a local-vs-cloud comparison:

| Run | What `ms` covers |
| --- | --- |
| DuckDB (embedded, local storage) | Engine work plus the Python fetch. No network. |
| Snowflake, TPC power test | Cursor setup; an `ALTER SESSION SET QUERY_TAG` round trip; the query round trip with queue, compile, execute and result transfer; then, still inside the outer timer, a `QUERY_HISTORY` lookup round trip, row count validation and `commit()`. Multi-statement queries add `BEGIN` and `COMMIT` round trips. |
| BigQuery, TPC power test | SQL rewrite, job submit, job wait, result fetch, and plan capture when it is not deferred. |
| Redshift, TPC power test | The query, plus `pg_last_query_id()` and `stl_query` lookups and a plan merge. |
| TPC power tests (all platforms) | Query text generation from the seed, since the outer timer starts before `get_query`. Throughput tests generate text before timing, except TPC-DS without preflight. |

Sources in core:

- `benchbox/platforms/snowflake.py:1144-1196`
- `benchbox/platforms/bigquery.py:1540-1624`
- `benchbox/platforms/redshift.py:1840-1882`
- `benchbox/core/tpch/power_test.py:213-265`
- `benchbox/core/tpcds/power_test.py:251-279`
- `benchbox/platforms/base/connection_wrappers.py:190-212`

For long queries the overhead is noise. For short ones (SF0.01 to SF1,
under about 100 ms) it can be most of the number. A DuckDB vs Snowflake
compare at SF1 then partly measures BenchBox's own extra round trips, and
partly the network.

### What exists today

- **Per query:** one time, `duration_ms`, which becomes `display_ms`.
- **Per run:** a round-trip floor, `statement_overhead_{min,median}_ms`.
  It comes from 1 warmup plus 5 `SELECT 1` calls after the run. On
  BigQuery each probe is a full job, so the floor measures the job API,
  not the network.
- **Platform stats collected but not published:**
  - Snowflake reads `QUERY_HISTORY`.
  - BigQuery keeps job timestamps.
  - Redshift reads `sys_query_history` on serverless and `stl_query` on
    provisioned. `stl_query` leaves out WLM queue time.

  These values ride in `resource_usage`. The compact query entry writes a
  fixed key set (`COMPACT_V2_QUERY_FIELDS`), so they never reach the
  bundle.
- **The Snowflake values are not trustworthy as collected:**
  - The lookup matches on query tag, takes the latest row, and has
    `max_retries=0`.
  - Throughput streams share tags, so a lookup can return another
    stream's query.
  - For explicit transactions it returns the `COMMIT`.
  - Redshift's `cpu_time_microsecs` is a copy of the duration.
- **The result cache is already turned off and recorded**
  (`result_cache_enabled`) for Snowflake, BigQuery and Redshift. There is
  no per-query cache-hit evidence.
- **Measurement basis** covers passes and statistic only
  (`measurementBasis.ts`).
- **Locality receipt:**
  - DuckDB vs a collocated Snowflake run reads as "2 localities differ",
    a warning that does not say why it matters.
  - DuckDB in process vs Postgres on localhost both read "Local" and
    count as a match.
  - `endpoint_class` exists in core (`embedded_process`,
    `localhost_port`, `remote_host`, `cloud_endpoint`) but is folded into
    `deployment_class` and never reaches the snapshot.
- **Core ADR** `adr-client-link-locality-disclosure.md`: "Disclose the
  topology; do not infer the distance." It rejects subtracting latency,
  and it rejects named latency bands.

## The two questions

People who put DuckDB and Snowflake side by side ask one of two things:

1. **Delivered latency.** "What will my client see?" For example: should
   I move small dashboard queries off Snowflake? End-to-end time answers
   this.
2. **Engine work.** "Which engine does the work faster?" Removing the
   measured round trip estimates this from BenchBox's own data. Time
   reported by the platform answers it more directly, but it comes from
   the vendor and has caveats.

No single default serves both. The page should answer both, side by side.

## Options

### A. Disclose only

Keep end-to-end time and improve the warnings.

- Pro: no new data needed, and it matches the ADR.
- Con: it never answers question 2.

### B. Subtract the measured floor

Compute a view that removes `round_trips × statement_overhead_min_ms`
from each query.

- Pro: BenchBox measures the round trip itself, so the system under test
  does not grade itself. It works on today's data, and on platforms
  that report no timing of their own.
- Con: it is an estimate.
  - The number of round trips per query varies by adapter and phase.
  - `SELECT 1` does not cover result transfer, and on BigQuery it
    measures the job API.
  - The floor is one figure per run, taken after the run.
  - The ADR rejects subtraction because it can hide stalls.
- Safe only as an opt-in, labeled estimate that leans conservative and is
  always shown next to end-to-end time.

### C. Publish a platform-reported clock

Add `platform_ms` per query, as the platform itself reports it.

- Pro: measured, not inferred.
- Con: it is the vendor's own telemetry about itself, and each platform
  defines it differently. As a default or a headline it would let the
  system under test grade itself.

### D. Shrink the overhead at the source

Move everything that is not the query out of the timers.

- Pro: makes end-to-end time more honest everywhere.
- Con: changes published numbers. Old and new runs must be told apart.

### E. Show both clocks side by side

Show the figures from B and C next to A's, with no default other than
end-to-end time.

- Pro: answers both questions, with nothing hidden.
- Con: a denser display.

## Decision

Do D first. Then B as an opt-in view, then C. Present every view as in
E. Keep A's warnings, improved.

1. **End-to-end time is the only default.** That holds on run pages,
   leaderboards and Compare, for any cohort. No other view is ever
   chosen automatically, and none drives a ranking unless the user picks
   it.
2. **Leaving out the round trip is the user's choice.** It uses the
   round trip BenchBox measured, labeled *round trip removed
   (estimated)*. It needs no platform timings, so it does not wait for
   them.
3. **Platform timings are always captured and published.** Every
   platform with a source records them per statement and keeps them raw.
   Run pages and downloads publish them in full, including values marked
   suspect. They are labeled *platform-reported* everywhere they appear,
   and carry their source.
4. **Gaps in coverage block the comparison.** A compare that mixes
   platform-time sources with different definitions is locked, just as
   mixed passes are today.

## Design

### Core: timer scope (option D)

Move these out of every measured timer:

- Snowflake: set the query tag before the timer starts.
- All adapters: per-query stats lookups (Snowflake `QUERY_HISTORY`,
  Redshift `pg_last_query_id` and `stl_query`), row count validation,
  and result digests.
- TPC power tests: query text generation (`get_query`) and `commit()`,
  unless the benchmark defines commit as part of the query.
- Plan capture: always deferred to its own phase.

Record `run.timing_method`, an integer that starts at 2 for the fixed
scope. Runs without it count as method 1. The Explorer:

- warns when a cohort mixes methods, and
- locks rankings that mix them, the same way it locks mixed bases.

The snapshot digest gate does not catch this change, because it skips
whenever the corpus changes. `timing_method` is the safeguard.

### Round trip removed (estimated)

For each query and run:

```text
removed_ms = round_trips × statement_overhead_min_ms
net_ms     = ms − removed_ms
```

Rules:

- **Use the floor's min, never its median.** The min is the smallest
  round trip observed, so the subtraction stays below the true
  overhead. The view leans toward under-correcting.
- **Round trips per query.** Core records `round_trips` for each query.
  Until it does, the Explorer uses a per-adapter count from a table in
  core, set from the timer scope after the D fixes. The receipt says
  "assumed N round trips".
- **Embedded engines** (`endpoint_class` of `embedded_process`) have no
  round trip: `net_ms = ms`. Localhost engines subtract their own,
  smaller floor.
- **Bounds:**
  - When `net_ms` falls below 10% of `ms`, or below `platform_ms` where
    that exists, the query is marked *round-trip dominated*. It is left
    out of this view's winner claims, with the reason shown.
  - The view never reports a value of zero or less.
- **Missing data:**
  - A run with no floor (`link_status` not collected, or
    `--no-link-probe`) cannot use this view, and the cohort is locked.
  - BigQuery is locked out until its probe measures a single round
    trip, because its `SELECT 1` is a full job, not a network round
    trip.
- **Displayed figures:** the view applies `net_ms` per execution, then
  takes the chosen basis statistic and the geomean as usual. End-to-end
  values stay visible in the same table.
- **Consistency check:** where a run has both this estimate and
  `platform_ms`, the receipt shows the gap between them. A large gap
  means the round-trip count or floor is wrong for that adapter.

This view answers "how would these engines compare if the client sat
next to them?" It is a BenchBox estimate, not a platform measurement.

### Core: schema 2.4

Capturing, keeping and publishing platform timings is separate from
using them in comparisons. Every query execution on a platform with a
source records them, in every pass, including warmup and failed
attempts. Comparisons choose which recorded values they use; capture and
publication do not depend on that choice.

Per query execution, next to `ms`, a `platform_timing` object:

| Field | Meaning |
| --- | --- |
| `source` | The platform view or API read, for example `snowflake.query_history`. |
| `statements` | One entry per statement the query ran, in order. Each has the platform's statement ID, the attempt number, the statement kind (query, `BEGIN`, `COMMIT`, setup), and `fields`: every timing and size field the source returns, under the platform's own names, converted to ms and bytes. |
| `platform_ms` | The derived total: the source's elapsed field, summed over the query's statements. Setup statements are left out. |
| `queue_ms`, `compile_ms`, `exec_ms` | Derived parts, when the source reports them. |
| `cache_hit` | Whether the platform reports a cache hit. |
| `status` | `valid`, `suspect` or `unavailable`, with a `reason`. |

Also per query execution:

| Field | Meaning |
| --- | --- |
| `round_trips` | Client round trips inside the timer for this query. |
| `result_rows`, `result_bytes` | The size of what crossed back to the client. |

Examples of the `fields` to keep in full:

- **Snowflake:** `TOTAL_ELAPSED_TIME`, `COMPILATION_TIME`,
  `EXECUTION_TIME`, the `QUEUED_*` times, `TRANSACTION_BLOCKED_TIME`,
  `LIST_EXTERNAL_FILES_TIME`, `BYTES_SCANNED`, `ROWS_PRODUCED`,
  `CREDITS_USED_CLOUD_SERVICES`.
- **BigQuery:** the job's `creation_time`, `start_time` and `end_time`;
  `total_slot_ms`; bytes processed and billed; `cache_hit`.
- **Redshift:** `SYS_QUERY_HISTORY` `elapsed_time`, `queue_time`,
  `execution_time` and `compile_time` on serverless, or the `stl_query`
  and `stl_wlm_query` times on provisioned.

Keeping the raw fields means a later change to how `platform_ms` is
derived can be re-run on old results, with no need to run the
benchmark again.

Per run, `run.platform_clock`:

- `source`: for example `snowflake.query_history.total_elapsed_time`.
- `definition`: one of the classes in the next section.
- `coverage`: the share of measured queries with a valid `platform_ms`.

The name `platform_ms` avoids clashing with the existing
`queries[].execution_engine`, and it matches the *platform-reported*
label.

A 2.4 bump must also update:

- `CURRENT_SCHEMA_VERSION` and `KNOWN_SCHEMA_V2_VERSIONS`
- `COMPACT_V2_QUERY_FIELDS`, `LEGACY_QUERY_FIELDS` and `query_key_order`
- the site's local preview (`explorer/src/lib/localResult.ts`), which
  must accept 2.4 before users can export it

Rules:

- **Capture by statement ID, never by tag.** Record the platform's ID
  for every statement (Snowflake `cursor.sfqid`, the BigQuery job ID,
  the Redshift query ID) and use only the successful attempt.
  - Look the IDs up after the measured phase, in batches spanning the
    run's time range. Chunk the Snowflake `INFORMATION_SCHEMA` lookups,
    which return a limited number of rows. Avoid `ACCOUNT_USAGE`, which
    lags.
  - Where the platform keeps history only briefly (Trino), capture the
    stats per query, outside the timer.
- **Validity marks, never deletes.** Keep every captured value. Set
  `status: suspect`, with a reason, when:
  - the statement count does not match the statements run, or
  - `platform_ms > ms`, or
  - the platform reports a cache hit, or
  - `platform_ms` is under 1% of `ms` and the query scanned nothing.

  Comparisons use only `valid` values. Run pages and exports show all
  of them, with their status.
- **Capture never blocks a run.** If a lookup fails, record
  `status: unavailable` with the error. Retry it after the run, up to a
  bounded deadline. The result bundle still publishes.
- **Conformance test per adapter.** A known-cost query, such as a sleep
  or a fixed scan, must yield `platform_ms` within a stated tolerance of
  its expected value.
- **Embedded, local-storage engines** (`endpoint_class` of
  `embedded_process`, without remote storage): set `platform_ms = ms`
  with `definition: client_equivalent`. The Explorer labels it "in
  process: same as end to end".
  - Classify by `endpoint_class` and storage backing, not by platform
    name. DuckLake on S3, MotherDuck, `pg_duckdb` and Snowpark Connect do
    not qualify.

### Platform time definitions

What each source includes. Explorer cohorts may compare only sources in
the same definition class. A run with no valid source has no platform
clock. Check each row against the live platform before shipping it.

| Source | Queue | Compile | Execute | Result streaming to client | Class |
| --- | --- | --- | --- | --- | --- |
| Snowflake `TOTAL_ELAPSED_TIME` | yes | yes | yes | no | `server_complete` |
| BigQuery job `end_time - creation_time` | yes | yes | yes | no | `server_complete` |
| Redshift serverless `SYS_QUERY_HISTORY.elapsed_time` | yes, as `queue_time` | yes | yes | no | `server_complete` |
| Redshift provisioned `stl_query` | no (WLM queue left out) | yes | yes | no | `server_no_queue` |
| Athena `TotalExecutionTimeInMillis` | yes | yes | yes | written to S3 | `server_complete` |
| Databricks `total_duration_ms` | yes | yes | yes | yes | `includes_fetch` |
| Trino `elapsedTime` | yes | yes | yes | yes | `includes_fetch` |
| ClickHouse `query_duration_ms` | no queue concept | yes | yes | yes | `includes_fetch` |
| MotherDuck | unknown | | | | none until checked |
| Embedded, local storage | n/a | yes | yes | Python fetch | `client_equivalent` |

`client_equivalent` may be compared with `server_complete`, but the
comparison is labeled. The local side includes the Python fetch, which
favors cloud engines on large results. Showing `result_rows` and
`result_bytes` lets readers judge how much.

### Snapshot read model

The Explorer refuses a snapshot older than it expects, and only warns on
a newer one (`db.ts:203-215`). So the order is:

1. Core emits read model 17 with the new columns. Today's Explorer loads
   it with a warning.
2. The Explorer moves to 17.

New columns and tables:

- `query_executions`: `platform_ms`, `platform_timing_status`,
  `round_trips`, `result_rows`, `result_bytes`.
- `query_platform_timings`, a new long-format table with one row per
  execution, statement and field: `result_id`, `query_id`, `iter`,
  `stream`, `statement_id`, `statement_kind`, `source`, `field`,
  `value`, `unit`. This publishes every captured field without a schema
  change per platform.
- `query_display_timings`: `display_platform_ms` over the same passes as
  `display_ms`, with its own validity and exclusion reason.
- `results`: `timing_method`, `platform_clock_source`,
  `platform_clock_definition`, `endpoint_class`.
- Basis availability: the clock becomes part of each per-basis
  availability token, so coverage is judged per pass and statistic.
  - A missing value means *end-to-end only*. Never treat it as
    available, the way `rowAnswersBasis` treats missing pass data today.

New columns on an unchanged corpus change the snapshot digest, so this
phase needs a digest approval.

### Explorer

`explorer/` is a replay copy of core's `results-explorer/`. Every change
below lands in core first and then replays here.

**Compare summary.** The end-to-end line always comes first. On a
mixed-transport cohort, add a line for each other view the cohort
supports:

> Delivered latency (end to end): DuckDB wins by 4.1x.
> Round trip removed (estimated): Snowflake wins by 1.2x.
> Engine work (platform-reported): Snowflake wins by 1.3x.

When the views disagree, say so. When a view is unavailable, say why.

**Per-query table and chart.**

- Show every available view as a column, over the same query set.
- Show a stacked bar for each networked run:
  - the estimated round trip removed;
  - where platform time exists, platform time and the rest of the
    *outside-engine time* (client, driver, protocol, transfer).

  Do not call the remainder "network".
- List the queries dropped from the shared set, with reasons.

**Clock choice.**

- Add a separate `clock` URL parameter:
  - `end_to_end`: the default, left out of the URL
  - `net`: round trip removed (estimated)
  - `platform`: platform-reported

  Keep it apart from the `basis` token, so the existing `encodeBasis`
  and `decodeBasis` grammar, `isDefaultBasis` and old links stay
  untouched.
- Choosing `net` or `platform` re-ranks rankings and winner claims by
  that view. `resolveResultsForBasis` then:
  - recomputes from `duration_ms` minus the removed round trips for
    `net`;
  - reads `display_platform_ms` for `platform`, and recomputes
    `platform_ms` for other bases (it is added to `BasisExecution`);
  - nulls Power@Size, Throughput@Size and cost, as non-default bases do
    today. The summary says "Power@Size is defined on end-to-end time;
    showing geomean".
- Mixed clocks are refused in cohorts, the same way mixed bases are.
- Leaderboards offer the platform clock only once most ranked cloud
  platforms have a source. A clock available for only two vendors would
  make those vendors look different.

**Run pages publish platform timings regardless of comparisons.** The
per-query table on a run page shows `platform_ms` and its parts next to
end-to-end time, with each value's status. A *Platform timings* panel
lists every captured field per statement. It needs no coverage gate and
no cohort, and appears whenever the run has timings.

**Downloads.** The run's JSON and CSV downloads include
`platform_timing` in full. The Explorer's SQL console exposes
`query_platform_timings`.

**Label every figure.** The clock and its provenance go in:

- the summary sentence and chart titles
- social preview images
- CSV and JSON export column names (`end_to_end_ms`,
  `platform_reported_ms`)
- the SQL view names

A screenshot or export must never be ambiguous.

**Comparability receipt.**

- Add a *Transport* field from `endpoint_class`: in process, localhost,
  or network. This fixes the in-process vs localhost match.
- Rewrite the locality summary to say why a difference matters, for
  example: "End-to-end times include client round trips for networked
  runs only."
- Show `timing_method` and the platform clock's source.

### Latency sensitivity

Fixed share bands ("25% is latency-bound") are dropped. They resemble the
bands the ADR rejects, they misfire on BigQuery, and they divide a single
round trip by several.

Instead, on the default end-to-end view of a mixed-transport compare,
compare the result with the *round trip removed* view:

- If a per-query winner or the headline flips, say so on the end-to-end
  view: "This result changes when client round trips are removed; 7 of
  22 queries flip."
- Link to the `net` view.

This tells users who stay on the default when round trips decide the
result. It uses the same rules as the view. Version it, because the
timer-scope fix changes round-trip counts.

For mixed-transport compares below the scale factor where the sensitivity
check passes, add a hint: "At this scale, client round trips are a large
share of query time; try a larger scale factor."

### Statistics

- Every view that shows both clocks uses one shared query set: queries
  valid in both clocks for every run. It shows the count dropped and
  the reasons.
- Coverage has one definition: the existing evidence gates (at least 2
  shared queries, and at least 50% valid per run) applied per clock.
- Per-query wins inside the tie band (`COMPARE_TIE_THRESHOLD`) are
  reported as ties under both clocks.

### Edge cases

- **Throughput tests:** throughput stays end-to-end only. Snowflake tags
  must include the stream ID until ID-based capture lands.
- **Failed or retried queries:** every attempt's timings are kept, with
  attempt numbers. Comparisons use only the successful attempt. Failed
  attempts appear on the run page.
- **Queue time:** it stays inside `platform_ms` for `server_complete`
  sources, because an undersized warehouse is the platform's cost.
  `queue_ms` is shown on its own when reported.
- **Vendor terms:** before publishing platform-reported figures, check
  each platform's terms on publishing benchmarks and on republishing its
  telemetry. Record the outcome in the ADR amendment.

## Rollout

| Phase | Where | Work | Needs |
| --- | --- | --- | --- |
| 0 | Core | Amend the locality ADR. A labeled, opt-in estimate that removes the measured round trip is allowed, shown next to end-to-end time and never the default. A platform-reported clock is disclosure under the same rules. Fixed latency bands stay rejected. Record the outcome of the terms check. | Owner decision. |
| 1 | Core | Timer scope fixes and `run.timing_method`. Stream ID in Snowflake tags. The per-adapter round-trip count table. | Changelog note. Cohort warnings for mixed methods. |
| 2 | Core | Schema 2.4: capture, keep and publish `platform_timing` (raw fields per statement, derived totals, status), `round_trips` and result size, using ID-based capture. Snowflake, BigQuery and Redshift first, then Athena, Databricks, Trino and ClickHouse; check MotherDuck. Conformance tests per adapter. | Schema bump. Site local preview accepts 2.4 first. Every new run from here on carries platform timings. |
| 3 | Core, then replay | Read model 17: `endpoint_class`, platform timing columns and `query_platform_timings`. Run pages and downloads show platform timings. The *round trip removed* view (`clock=net`), with its column, stacked bar, summary line and flip notice. The Transport receipt field, the rewritten locality text, and the scale-factor hint. | Read model 17 from core first. Digest approval. |
| 4 | Core, then replay | The platform-reported clock in comparisons (`clock=platform`), with summary line, columns and export labels. | Digest approval if columns change. |
| 5 | Core, then replay | The leaderboard platform clock, once coverage across ranked cloud platforms is broad. | Coverage check. |

## Rejected alternatives

- **Removing the round trip by default:** the headline would rest on an
  estimate, and it would hide stalls on the default view. It stays
  opt-in.
- **Subtracting the median floor:** the median can exceed the round trip
  a given query actually paid, so it can over-correct. The min is used.
- **Switching the default clock by cohort:** links and rankings would
  change meaning as runs were added, and Compare and leaderboards would
  disagree. For the platform clock, it would also let the vendor's own
  telemetry decide the headline.
- **A fixed latency-bound share threshold:** a named band by another
  name. Replaced by the sensitivity check.
- **Dropping short queries from winner claims below a duration
  threshold:** hides data, and the threshold invites tuning to a result.
  The sensitivity check flags these queries without hiding them.
- **Reusing the stats Snowflake collects today:** matched by tag, so
  they can belong to another stream or to `COMMIT`.
- **A third part in the `basis` token:** breaks the token grammar and
  `isDefaultBasis`, and old builds would silently fall back. A separate
  `clock` parameter is cleaner.

## Open questions

1. Should DuckDB use its own profiler latency instead of
   `client_equivalent`? It would leave out the Python fetch, the
   counterpart of excluding result transfer on cloud platforms. But
   profiling may add overhead to measured passes. Measure that overhead
   first.
2. Should Redshift provisioned (`server_no_queue`) be comparable with
   `server_complete` when the reported queue time is zero?
3. What share of ranked cloud platforms must have a platform clock before
   leaderboards offer it?
4. Is 10% of `ms` the right lower bound for marking a query
   *round-trip dominated* in the estimated view?
5. Should the link probe run again during long runs, so the floor
   follows drift? Today it runs once, after the run.
6. Should `query_platform_timings` ship in the main snapshot, or as a
   separate file the Explorer loads only when a run page or the SQL
   console needs it? The snapshot is loaded in the browser, and one row
   per field per statement could grow it substantially. Measure that on
   a full corpus first.
