# Comparing Local and Cloud Runs: Round-Trip Latency

How the Explorer should compare an in-process run (DuckDB, Polars) with a
networked run (Snowflake, BigQuery), and whether to leave client
round-trip time out of the comparison.

**Decision in brief:**

- End-to-end time stays the only default, on every page.
- Users can choose to leave out the client round trip that BenchBox
  measured. This view is labeled *round trip removed (estimated)*. It is
  shown next to end-to-end time, never in place of it.
- Embedded runs have no network between client and engine, so they keep
  their end-to-end time in every view.
- Core captures the timings each platform reports for every query and
  keeps them in the result bundles. They stay out of the Explorer for
  now and can be added later if a page needs them.
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
compare at SF1 then partly measures BenchBox's own extra round trips,
and partly the network.

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
- **Redshift's `cpu_time_microsecs`** is a copy of the duration.
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
   measured round trip estimates this from BenchBox's own data.

No single default serves both. The page answers both, side by side, with
end-to-end time first.

## Options

### A. Disclose only

Keep end-to-end time and improve the warnings.

- Pro: no new data needed, and it matches the ADR.
- Con: it never answers question 2.

### B. Subtract the measured floor

Remove one measured floor (`statement_overhead_min_ms`) for each SQL
statement the query sends.

- Pro: BenchBox measures the round trip itself, so the system under test
  does not grade itself. It works on platforms that report no timing of
  their own.
- Con: it is an estimate.
  - It is sound only once the timer covers just the query's own
    statements, so it applies to runs after the timer fix.
  - `SELECT 1` does not cover result transfer, and on BigQuery it
    measures the job API.
  - The floor is one figure per run, taken after the run.
  - The ADR rejects subtraction because it can hide stalls.
- Safe only as an opt-in, labeled estimate that leans conservative and is
  always shown next to end-to-end time.

### C. A platform-reported clock

Use each platform's own reported time in comparisons.

- Pro: measured by the platform, not inferred.
- Con: it is the vendor's own telemetry about itself, each platform
  defines it differently, and coverage arrives one platform at a time.

### D. Shrink the overhead at the source

Move everything that is not the query out of the timers.

- Pro: makes end-to-end time more honest everywhere.
- Con: changes published numbers. Old and new runs must be told apart.

### E. Show every view side by side

Show B's figures next to A's, with no default other than end-to-end time.

- Pro: answers both questions, with nothing hidden.
- Con: a denser display.

## Decision

Do D first. Then B as an opt-in view, presented as in E. Keep A's
warnings, improved. Capture C's data in core now, but keep it out of the
Explorer for now.

1. **End-to-end time is the only default.** That holds on run pages,
   leaderboards and Compare, for any cohort. No other view is ever
   chosen automatically, and none drives a ranking unless the user picks
   it.
2. **Leaving out the round trip is the user's choice.** It uses the
   round trip BenchBox measured, labeled *round trip removed
   (estimated)*.
3. **Embedded runs keep their end-to-end time.** With client and engine
   on one machine there is no network latency to remove.
4. **Platform timings are captured and kept in the result bundles.**
   Every platform with a source records them per statement and keeps
   them raw, including values marked suspect. The Explorer snapshot and
   pages leave them out for now.

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

For each networked query execution:

```text
removed_ms = statement_count × statement_overhead_min_ms
net_ms     = ms − removed_ms
```

`statement_count` is the number of SQL statements the client sent inside
the timer for that query, including any `BEGIN` and `COMMIT`. Almost
every benchmark query is one statement. It is a plain count, not a new
latency metric. Core writes it from the statement split the adapter
already does.

Rules:

- **Use the floor's min, never its median.** The min is the smallest
  round trip observed, so the subtraction stays below the true
  overhead. Large results that need extra fetch round trips are not
  counted either. The view leans toward under-correcting.
- **Fixed timer scope only.** The view is offered only for runs with
  `timing_method` 2 or later. Before the fix, Snowflake and Redshift
  timers include extra calls (tag setup, stats lookups), so one floor per
  statement would describe the wrong thing.
- **The probe runs as it does today:** once, after the measured run. The
  receipt shows when the floor was taken.
- **Embedded engines are out of scope.** For `endpoint_class` of
  `embedded_process` with local storage, every view uses end-to-end time
  unchanged and labels it "in process".
  - Classify by `endpoint_class` and storage backing, not by platform
    name. DuckLake on S3, MotherDuck, `pg_duckdb` and Snowpark Connect
    reach remote storage or a remote service, so they are not embedded
    for this purpose.
- **Localhost engines** subtract their own, smaller floor.
- **Bounds:**
  - When `net_ms` falls below 10% of `ms`, the query is marked
    *round-trip dominated*. It is left out of this view's winner claims,
    with the reason shown.
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

This view answers "how would these engines compare if the client sat
next to them?" It is a BenchBox estimate, not a platform measurement.

**Validating the estimate.** Core checks the estimate per adapter
against the platform timings it captures: for each conformance run, the
gap between `ms − platform_ms` and `removed_ms`. A large gap means the
floor misses part of that adapter's overhead. That check reads the
bundles; it needs nothing in the Explorer.

### Core: schema 2.4

Every query execution on a platform with a source records platform
timings, in every pass, including warmup and failed attempts.

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
| `statement_count` | SQL statements the client sent inside the timer for this query. |
| `result_rows`, `result_bytes` | The size of what crossed back to the client. |

Per run, `run.platform_timing`: the `source`, its `definition` class
(next section), and `coverage`, the share of measured queries with a
valid `platform_ms`.

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
derived can be re-run on old results, with no need to run the benchmark
again. The name `platform_ms` avoids clashing with the existing
`queries[].execution_engine`.

A 2.4 bump must also update:

- `CURRENT_SCHEMA_VERSION` and `KNOWN_SCHEMA_V2_VERSIONS`
- `COMPACT_V2_QUERY_FIELDS`, `LEGACY_QUERY_FIELDS` and `query_key_order`
- the site's local preview (`explorer/src/lib/localResult.ts`), which
  must accept 2.4 before users can export it

Rules:

- **Capture by statement ID, never by tag.** Record the platform's ID
  for every statement (Snowflake `cursor.sfqid`, the BigQuery job ID,
  the Redshift query ID) and every attempt.
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
- **Capture never blocks a run.** If a lookup fails, record
  `status: unavailable` with the error. Retry it after the run, up to a
  bounded deadline. The result bundle still publishes.
- **Conformance test per adapter.** A known-cost query, such as a sleep
  or a fixed scan, must yield `platform_ms` within a stated tolerance of
  its expected value.
- **Embedded, local-storage engines** have no platform timing to
  capture, and core writes none.

### Platform time definitions

What each source includes, recorded as the run's `definition` class.
Check each row against the live platform before shipping it.

| Source | Queue | Compile | Execute | Result streaming to client | Class |
| --- | --- | --- | --- | --- | --- |
| Snowflake `TOTAL_ELAPSED_TIME` | yes | yes | yes | no | `server_complete` |
| BigQuery job `end_time - creation_time` | yes | yes | yes | no | `server_complete` |
| Redshift serverless `SYS_QUERY_HISTORY.elapsed_time` | yes, as `queue_time` | yes | yes | no | `server_complete` |
| Redshift provisioned `stl_query` | no (WLM queue left out) | yes | yes | no | `server_complete` |
| Athena `TotalExecutionTimeInMillis` | yes | yes | yes | written to S3 | `server_complete` |
| Databricks `total_duration_ms` | yes | yes | yes | yes | `includes_fetch` |
| Trino `elapsedTime` | yes | yes | yes | yes | `includes_fetch` |
| ClickHouse `query_duration_ms` | no queue concept | yes | yes | yes | `includes_fetch` |
| MotherDuck | unknown | | | | none until checked |

Redshift provisioned counts as `server_complete` even though `stl_query`
leaves out WLM queue time. The bundle keeps any queue time reported in
`stl_wlm_query`.

### Snapshot read model

The Explorer refuses a snapshot older than it expects, and only warns on
a newer one (`db.ts:203-215`). So the order is:

1. Core emits read model 17 with the new columns. Today's Explorer loads
   it with a warning.
2. The Explorer moves to 17.

New columns, only what the round-trip view and the receipt need:

- `query_executions`: `statement_count`.
- `results`: `timing_method`, `endpoint_class`.
- Basis availability: the clock becomes part of each per-basis
  availability token, so coverage is judged per pass and statistic.
  - A missing value means *end-to-end only*. Never treat it as
    available, the way `rowAnswersBasis` treats missing pass data today.

Platform timings are not in the snapshot.

New columns on an unchanged corpus change the snapshot digest, so this
phase needs a digest approval.

### Explorer

`explorer/` is a replay copy of core's `results-explorer/`. Every change
below lands in core first and then replays here.

**Compare summary.** The end-to-end line always comes first. On a
mixed-transport cohort where the estimate is available, add its line:

> Delivered latency (end to end): DuckDB wins by 4.1x.
> Round trip removed (estimated): Snowflake wins by 1.2x.

When the two disagree, say so. When the estimate is unavailable, say
why.

**Per-query table and chart.**

- Show end-to-end and estimated columns, over the same query set.
- For each networked run, show a stacked bar: the estimated round trip
  removed, then the rest. Do not call the rest "engine time"; it still
  includes driver, protocol and transfer time.
- List the queries dropped from the shared set, with reasons.

**Clock choice.**

- Add a separate `clock` URL parameter: `end_to_end` (the default, left
  out of the URL) or `net`. Keep it apart from the `basis` token, so the
  existing `encodeBasis` and `decodeBasis` grammar, `isDefaultBasis` and
  old links stay untouched.
- Choosing `net` re-ranks rankings and winner claims by the estimate.
  `resolveResultsForBasis` then:
  - recomputes from `duration_ms` minus one floor per statement;
  - nulls Power@Size, Throughput@Size and cost, as non-default bases do
    today. The summary says "Power@Size is defined on end-to-end time;
    showing geomean".
- Mixed clocks are refused in cohorts, the same way mixed bases are.

**Label every figure.** The clock goes in:

- the summary sentence and chart titles
- social preview images
- CSV and JSON export column names (`end_to_end_ms`,
  `round_trip_removed_estimated_ms`)
- the SQL view names

A screenshot or export must never be ambiguous.

**Comparability receipt.**

- Add a *Transport* field from `endpoint_class`: in process, localhost,
  or network. This fixes the in-process vs localhost match.
- Rewrite the locality summary to say why a difference matters, for
  example: "End-to-end times include client round trips for networked
  runs only."
- Show `timing_method`, and the floor used with when it was taken.

### Latency sensitivity

Fixed share bands ("25% is latency-bound") are dropped. They resemble
the bands the ADR rejects, and they misfire on BigQuery.

Instead, on the default end-to-end view of a mixed-transport compare,
compare the result with the *round trip removed* view:

- If a per-query winner or the headline flips, say so on the end-to-end
  view: "This result changes when client round trips are removed; 7 of
  22 queries flip."
- Link to the `net` view.

This tells users who stay on the default when round trips decide the
result. It uses the same rules as the view, so it too applies only to
runs with the fixed timer scope.

For mixed-transport compares below the scale factor where the
sensitivity check passes, add a hint: "At this scale, client round trips
are a large share of query time; try a larger scale factor."

### Statistics

- Every view that shows both figures uses one shared query set: queries
  valid in both for every run. It shows the count dropped and the
  reasons.
- Coverage has one definition: the existing evidence gates (at least 2
  shared queries, and at least 50% valid per run) applied per clock.
- Per-query wins inside the tie band (`COMPARE_TIE_THRESHOLD`) are
  reported as ties in both views.

### Edge cases

- **Throughput tests:** throughput stays end-to-end only. Snowflake tags
  must include the stream ID until ID-based capture lands.
- **Failed or retried queries:** every attempt's platform timings are
  kept in the bundle, with attempt numbers.
- **Queue time:** it stays inside `platform_ms` for `server_complete`
  sources, because an undersized warehouse is the platform's cost.
- **Vendor terms:** result bundles are public downloads. Before they
  carry platform timings, check each platform's terms on publishing
  benchmarks and on republishing its telemetry. Record the outcome in
  the ADR amendment.

### Later: platform timings in the Explorer

Deferred until a page needs them. Adding them would take:

- snapshot columns for the derived totals, and a lazily loaded file for
  the raw fields;
- a `clock=platform` view, labeled *platform-reported*, locked to one
  definition class per cohort;
- a rule for leaderboards, so that the platforms with a source first do
  not look different just from coverage.

## Rollout

| Phase | Where | Work | Needs |
| --- | --- | --- | --- |
| 0 | Core | Amend the locality ADR. A labeled, opt-in estimate that removes the measured round trip is allowed, shown next to end-to-end time and never the default. Platform timings are captured and published in result bundles. Fixed latency bands stay rejected. Record the outcome of the terms check. | Owner decision (agreed). |
| 1 | Core | Timer scope fixes and `run.timing_method`. Stream ID in Snowflake tags. | Changelog note. Cohort warnings for mixed methods. |
| 2 | Core | Schema 2.4: `platform_timing` (raw fields per statement, derived totals, status), `statement_count` and result size, using ID-based capture. Snowflake, BigQuery and Redshift first, then Athena, Databricks, Trino and ClickHouse; check MotherDuck. Conformance tests per adapter, including the estimate check. | Schema bump. Site local preview accepts 2.4 first. |
| 3 | Core, then replay | Read model 17: `statement_count`, `timing_method`, `endpoint_class`. The *round trip removed* view (`clock=net`), with its column, stacked bar, summary line and flip notice. The Transport receipt field, the rewritten locality text, and the scale-factor hint. | Read model 17 from core first. Digest approval. |
| Later | Core, then replay | Platform timings in the Explorer, if needed. | Its own design pass. |

## Rejected alternatives

- **Removing the round trip by default:** the headline would rest on an
  estimate, and it would hide stalls on the default view. It stays
  opt-in.
- **Subtracting the median floor:** the median can exceed the round trip
  a given query actually paid, so it can over-correct. The min is used.
- **A per-query round-trip count:** never an agreed metric, and hard to
  define across drivers. One floor per statement, on runs with the fixed
  timer scope, needs only a plain statement count.
- **Switching the default view by cohort:** links and rankings would
  change meaning as runs were added, and Compare and leaderboards would
  disagree.
- **A fixed latency-bound share threshold:** a named band by another
  name. Replaced by the sensitivity check.
- **Dropping short queries from winner claims below a duration
  threshold:** hides data, and the threshold invites tuning to a result.
  The sensitivity check flags these queries without hiding them.
- **DuckDB profiler time for embedded runs:** the question it answers
  does not arise. With client and engine on one machine there is no
  network latency to remove.
- **Re-probing during long runs:** not worth the extra code for now. The
  receipt shows when the floor was taken.
- **Reusing the stats Snowflake collects today:** matched by tag, so
  they can belong to another stream or to `COMMIT`.
- **A third part in the `basis` token:** breaks the token grammar and
  `isDefaultBasis`, and old builds would silently fall back. A separate
  `clock` parameter is cleaner.

## Open questions

None. Platform timings in the Explorer are deferred, not open.
