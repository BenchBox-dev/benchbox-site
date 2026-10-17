# Comparing Local and Cloud Runs: Round-Trip Latency

How the Explorer should compare an in-process run (DuckDB, Polars) with a
networked run (Snowflake, Redshift), and whether to leave client
round-trip time out of the comparison.

**Decision in brief:**

- End-to-end time stays the only default, on every page.
- On Compare, users can choose to leave out the client round trip that
  BenchBox measured. This view is labeled *round trip removed
  (estimated)*. It is shown with end-to-end time, never in place of it.
- An adapter gets that view only after core shows that its round-trip
  probe measures transport, not server work.
- Embedded runs have no network between client and engine, so they keep
  their end-to-end time in every view.
- Core captures the timings each platform reports for every query and
  keeps them in the result bundles. They stay out of the Explorer for
  now.
- Before any of this ships, fix the timers in core so they stop counting
  work that is not the query.

## Problem

Every published query time is the client's end-to-end wall clock. That
means different things on each side of a local-vs-cloud comparison:

| Run | What `ms` covers |
| --- | --- |
| DuckDB (embedded) | Engine work plus the Python fetch. No network. |
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
- **Per run:** a round-trip floor, `statement_overhead_{min,median}_ms`,
  already in the snapshot (`result_environment`).
  - It comes from 1 warmup plus 5 `SELECT 1` calls on one warm cursor,
    after the run, within a 5-second deadline (`link_probe.py`).
  - It times execute plus fetch, so on most cloud SQL services it also
    includes the service's minimum per-statement work (parse, compile,
    admission). On BigQuery and Athena each probe is a full job.
  - No timestamp is recorded.
  - `link_status` is `available`, `partial`, `not_requested` or
    `unavailable`. `partial` can mean the probe failed.
- **Statements sent:** only Snowflake, Databricks, DataFusion and the
  MySQL-wire path split multi-statement text before sending. Redshift and
  the Postgres family send the whole text in one `execute`, and BigQuery
  submits one job.
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
  (`result_cache_enabled`) for Snowflake, BigQuery and Redshift.
- **Measurement basis** covers passes and statistic only. On the default
  basis, `resolveQueryValue` and `resolveResultsForBasis` return the
  published end-to-end values directly (`measurementBasis.ts:290-301`).
- **Leaderboard ranks** are computed in core and read as `row.rank`; the
  page does not re-rank (`Leaderboard.tsx:282-295`).
- **Locality receipt:**
  - DuckDB vs a collocated Snowflake run reads as "2 localities differ",
    a warning that does not say why it matters.
  - DuckDB in process vs Postgres on localhost both read "Local" and
    count as a match.
  - It shows the floor's median, not its min.
- **`endpoint_class`** exists in core (`embedded_process`,
  `localhost_port`, `remote_host`, `cloud_endpoint`, `unknown`) but is
  folded into `deployment_class` and never reaches the snapshot. Any
  DuckDB connection is `embedded_process`, whatever its storage.
- **Core ADR** `adr-client-link-locality-disclosure.md`: "Disclose the
  topology; do not infer the distance." It rejects subtracting latency,
  and it rejects named latency bands.

## The two questions

People who put DuckDB and Snowflake side by side ask one of two things:

1. **Delivered latency.** "What will my client see?" For example: should
   I move small dashboard queries off Snowflake? End-to-end time answers
   this.
2. **Most of the engine's work.** "How do they compare once the client
   round trip is taken out?" Removing BenchBox's measured round trip
   estimates this, on the recorded hardware. It leaves in result
   transfer, extra fetch round trips and driver work, so it is a partial,
   conservative correction.

No single default serves both. Compare answers both in one sentence,
with end-to-end time first.

## Options

### A. Disclose only

Keep end-to-end time and improve the warnings.

- Pro: no new data needed, and it matches the ADR.
- Con: it never answers question 2.

### B. Subtract the measured floor

Remove one measured floor (`statement_overhead_min_ms`) for each request
the client sends inside the query's timer.

- Pro: BenchBox measures the round trip itself, so the system under test
  does not grade itself. It works on platforms that report no timing of
  their own.
- Con: it is an estimate.
  - It is sound only once the timer covers just the query's own
    requests, so it applies to runs after the timer fix.
  - On most cloud services `SELECT 1` includes server work, which would
    be wrongly removed. Each adapter must pass a check first.
  - The floor is one figure per run, taken after the run.
  - The ADR rejects subtraction because it can hide stalls.
- Safe only as an opt-in, labeled estimate that leans conservative and is
  always shown with end-to-end time.

### C. A platform-reported clock

Use each platform's own reported time in comparisons.

- Pro: measured by the platform, not inferred.
- Con: it is the vendor's own telemetry about itself, each platform
  defines it differently, and coverage arrives one platform at a time.

### D. Shrink the overhead at the source

Move everything that is not the query out of the timers.

- Pro: makes end-to-end time more honest everywhere.
- Con: changes published numbers. Old and new runs must be told apart.

### E. Show every view together

Show B's figures with A's, with no default other than end-to-end time.

- Pro: answers both questions, with nothing hidden.
- Con: a denser display.

## Decision

Do D first. Then B as an opt-in view on Compare, presented as in E. Keep
A's warnings, improved. Capture C's data in core now, but keep it out of
the Explorer.

1. **End-to-end time is the only default.** That holds on run pages,
   leaderboards and Compare, for any cohort. No other view is ever
   chosen automatically.
2. **Leaving out the round trip is the user's choice, on Compare.** It
   uses the round trip BenchBox measured, labeled *round trip removed
   (estimated)*. Leaderboards stay end-to-end.
3. **Each adapter must earn the view.** Core checks, per adapter, that
   the probe measures transport and not server work. Until an adapter
   passes, its runs show end-to-end time only.
4. **Embedded runs keep their end-to-end time.** With client and engine
   on one machine there is no network latency to remove.
5. **Platform timings are captured and kept in the result bundles.**
   Every platform with a source records them raw, including values
   marked suspect. The Explorer snapshot and pages leave them out.

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
scope, as part of schema 2.4. Runs without it count as method 1.

- `timing_method` joins the cohort signature (`compareCohort.ts`) and
  core's leaderboard cohorts, so runs are ranked and compared within one
  method. Mixed-method Compare cohorts warn and suppress winner claims.
- Leaderboards show the newest method that has ranked runs for a cohort,
  with a link to the other.
- Core holds method-2 runs out of the published corpus until the
  Explorer reads `timing_method` (read model 17). Otherwise old and new
  runs would mix unseen: the snapshot digest gate skips whenever the
  corpus changes.

**Re-runs.** The timer fix touches every platform, DuckDB included, and
the round-trip view needs method-2 runs. Before the view launches, re-run
the canonical corpus with method 2: the benchmarks and scale factors the
home page and blog posts cite, for each platform they show. Launch the
view once there are method-2 local and cloud runs for at least TPC-H at
SF1 and SF10.

### Round trip removed (estimated)

For each networked query execution:

```text
removed_ms = request_count × statement_overhead_min_ms
net_ms     = ms − removed_ms
```

`request_count` is the number of requests the adapter sent to the
platform inside the timer for that query: each `execute()` or job
submit, including any `BEGIN` and `COMMIT`. Core counts the calls at the
adapter's call site; it does not parse the SQL.

- Almost every benchmark query is one request.
- TPC-H Q15 is three requests on Snowflake, which splits it, and one on
  Redshift, which sends it whole.

It is a plain count of calls, not a new latency metric.

#### Eligibility

The view is offered for a run only when all of these hold:

- `endpoint_class` is `localhost_port`, `remote_host` or
  `cloud_endpoint`. `embedded_process` always keeps end-to-end time;
  `unknown` cannot use the view.
- `timing_method` is 2 or later.
- `statement_overhead_min_ms` is present from at least 5 samples.
- The adapter passes the probe check (below). Core publishes the result
  per run as `net_estimate_status` (`eligible`, or a reason).
- No measured execution in the run has `ms < removed_ms`. If one does,
  the floor is larger than time actually measured (for example after
  network drift), so the floor is marked suspect and the run locked.

#### Probe check

`SELECT 1` on most cloud services runs through parse, compile and
admission, so the floor can include server work the view must not
remove. Core checks each adapter before it is eligible:

1. Record the platform statement IDs of the probe's `SELECT 1` calls and
   capture their platform timings into the bundle, like any query.
2. On conformance runs, compare the floor with the probe's own platform
   time, and compare `removed_ms` with `ms − platform_ms` per query.
3. The adapter passes when the probe's platform time is under a stated
   share of the floor, and `removed_ms` stays below `ms − platform_ms`
   within a stated tolerance.

Every adapter starts ineligible, including BigQuery and Athena, whose
probes run full jobs. The per-adapter results go on the methods page.

#### Rules

- **Use the floor's min.** The min is the smallest round trip observed
  on a warm cursor. The query path also creates a cursor, which the probe
  leaves out, so the subtraction stays below the true overhead. Large
  results that need extra fetch round trips are not counted either. For
  eligible adapters the view under-corrects networked runs, so it errs
  toward the local engine.
- **Embedded runs** have `removed_ms = 0`. Their figure in this view
  equals their end-to-end time, labeled "in process: nothing removed;
  includes client fetch".
- **Localhost engines** subtract their own, smaller floor, which
  includes socket, protocol and driver work. Embedded engines' per-call
  overhead is not subtracted. The asymmetry is small, and the methods
  page states it.
- **The probe runs as it does today:** once, after the measured run.
  Schema 2.4 adds `probed_at`. The receipt shows when the floor was
  taken, and its min, median and spread.
- **Round-trip dominated queries.** A query is *round-trip dominated*
  when, for any networked run in the cohort, its net value under the
  chosen basis statistic is below 10% of its end-to-end value. Such a
  query:
  - leaves the round-trip view for every run in the cohort, for both the
    geomean and the win counts;
  - shows "round-trip dominated: under 10% of end-to-end left" in its
    cell, never a number;
  - is null in exports, with a reason column;
  - is still valid for the end-to-end view and the coverage gate.

  This is a reliability floor on a derived estimate, applied only inside
  the opt-in view. It labels no run and ranks nothing. It is fixed in
  core, is the same for every platform, and is shown on the receipt.
- **Displayed figures:** the view subtracts per execution, then takes
  the chosen basis statistic and the geomean as usual.

This view answers "how do these engines compare with BenchBox's measured
per-statement round trip taken out, on the recorded hardware?" It is a
BenchBox estimate, not a platform measurement.

### Core: schema 2.4

Every query execution on a platform with a source records platform
timings, in every pass, including warmup, failed attempts and the link
probe.

Per query execution, next to `ms`, a `platform_timing` object:

| Field | Meaning |
| --- | --- |
| `source` | The platform view or API read, for example `snowflake.query_history`. |
| `requests` | One entry per request the adapter sent, in order. Each has the platform's ID for it, the attempt number, the kind (query, `BEGIN`, `COMMIT`, setup), and `fields`: every timing and size field the source returns for it, under the platform's own names, converted to ms and bytes. |
| `platform_ms` | The derived total: the source's elapsed field, summed over the query's requests. Setup requests are left out. |
| `queue_ms`, `compile_ms`, `exec_ms` | Derived parts, when the source reports them. |
| `cache_hit` | Whether the platform reports a cache hit. |
| `status` | `valid`, `suspect` or `unavailable`, with a `reason`. |

Also per query execution:

| Field | Meaning |
| --- | --- |
| `request_count` | Requests the adapter sent inside the timer for this query. |
| `result_rows`, `result_bytes` | The size of what crossed back to the client. |

Per run:

- `run.timing_method`.
- `run.platform_timing`: the `source`, its `definition` class (next
  section), and `coverage`, the share of measured queries with a valid
  `platform_ms`.
- `run.net_estimate_status`.
- `environment.client_link.probed_at`, and the probe's platform timings.

Examples of the `fields` to keep in full:

- **Snowflake:** `TOTAL_ELAPSED_TIME`, `COMPILATION_TIME`,
  `EXECUTION_TIME`, the `QUEUED_*` times, `TRANSACTION_BLOCKED_TIME`,
  `LIST_EXTERNAL_FILES_TIME`, `BYTES_SCANNED`, `ROWS_PRODUCED`,
  `CREDITS_USED_CLOUD_SERVICES`.
- **BigQuery:** the job's `creation_time`, `start_time` and `end_time`;
  `total_slot_ms`; bytes processed and billed; `cache_hit`.
- **Redshift:** `SYS_QUERY_HISTORY` `elapsed_time`, `queue_time`,
  `execution_time` and `compile_time` on serverless, or the `stl_query`
  and `stl_wlm_query` times on provisioned. A multi-statement text sent
  in one `execute` yields one `pg_last_query_id()`, so it is one request
  entry.

Keeping the raw fields means a later change to how `platform_ms` is
derived can be re-run on old results, with no need to run the benchmark
again. The name `platform_ms` avoids clashing with the existing
`queries[].execution_engine`.

A 2.4 bump must also update:

- `CURRENT_SCHEMA_VERSION` and `KNOWN_SCHEMA_V2_VERSIONS`
  (`schema_policy.py`)
- `COMPACT_V2_QUERY_FIELDS` and `LEGACY_QUERY_FIELDS`
  (`query_execution.py`), and `query_key_order` (`schema_specs.yaml`)
- bundle validation (`benchbox/validation/bundle.py`) and the explorer
  pipeline models
- the site's local preview (`explorer/src/lib/localResult.ts`), which
  must accept 2.4 before users can export it

Rules:

- **Capture by platform ID, never by tag.** Record the platform's ID for
  every request (Snowflake `cursor.sfqid`, the BigQuery job ID, the
  Redshift query ID) and every attempt.
  - Look the IDs up after the measured phase, in batches spanning the
    run's time range. Chunk the Snowflake `INFORMATION_SCHEMA` lookups,
    which return a limited number of rows. Avoid `ACCOUNT_USAGE`, which
    lags.
  - Where the platform keeps history only briefly (Trino), capture the
    stats per query, outside the timer.
- **Validity marks, never deletes.** Keep every captured value. Set
  `status: suspect`, with a reason, when:
  - the number of platform IDs does not match `request_count`, or
  - `platform_ms > ms`, or
  - the platform reports a cache hit, or
  - `platform_ms` is under 1% of `ms` and the query scanned nothing.
- **Capture never blocks a run.** If a lookup fails, record
  `status: unavailable` with the error. Retry it after the run, up to a
  bounded deadline. The result bundle still publishes.
- **Conformance test per adapter.** A known-cost query, such as a sleep
  or a fixed scan, must yield `platform_ms` within a stated tolerance of
  its expected value. The same runs feed the probe check.
- **Embedded engines** have no platform timing to capture, and core
  writes none.

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
   it with a warning and ignores them.
2. The Explorer moves to 17.

New columns, only what the round-trip view, the cohort lock and the
receipt need:

- `query_executions`: `request_count`.
- `results`: `timing_method`, `endpoint_class`, `net_estimate_status`.
- `result_environment`: `statement_overhead_sample_count`, `probed_at`.

`available_bases` stays as it is. A null `net_estimate_status` means
*end-to-end only*. Platform timings are not in the snapshot.

New columns on an unchanged corpus change the snapshot digest, so this
phase needs a digest approval.

### Explorer

`explorer/` is a replay copy of core's `results-explorer/`. Every change
below lands in core first and then replays here.

**Clock choice.**

- Compare gets a separate `clock` URL parameter: `end_to_end` (the
  default, left out of the URL) or `net`. It stays apart from the
  `basis` token, so `encodeBasis`, `decodeBasis` and old links stay
  untouched.
- `clock` threads through `sharedQueryGeomeans`, `resolveQueryValue` and
  `resolveResultsForBasis`. Their published-value shortcut applies only
  when `isDefaultBasis(basis) && clock === "end_to_end"`. Tests cover
  `clock=net` on the default basis.
- On `net`:
  - values are recomputed from `duration_ms` minus `removed_ms` per
    execution;
  - Power@Size, Throughput@Size and cost are nulled, and the summary
    says "Power@Size is defined on end-to-end time; showing geomean".
- A cohort can use `net` only when every networked run in it is
  eligible. Otherwise the view is offered with the reason it is
  unavailable, naming the run.
- Leaderboards stay end-to-end; their ranks come from core.
  `leaderboardCompareHref` and the other link builders carry `clock`.

**Compare summary.** Under `net`, one sentence carries both figures, so
neither can be quoted alone. It uses the existing "than the slowest
selected run" grammar:

> End to end, DuckDB's geomean query time was 4.1x faster than the
> slowest selected run. With BenchBox's measured round trip removed
> (estimate, 17 of 22 shared queries; 5 round-trip dominated, not
> ranked), Snowflake's was about 1.2x faster (1.1–1.3x using the
> floor's min to median).

- The range recomputes the net figure with the floor's median. The
  headline uses the min.
- When the two answers name different winners, the sentence says
  "The winner changes when the round trip is removed."
- Social preview images and the copied link title render the whole
  sentence when `clock=net`.

**Query sets.**

- The end-to-end figure always uses the end-to-end shared set, the same
  as on the default page.
- The net figure uses that set minus round-trip-dominated queries, and
  shows its count.
- The flip notice uses the intersection.

**Per-query table and chart.**

- Show end-to-end and estimated columns.
- Show a stacked bar for each eligible networked run. The legend reads
  "estimated round trip (removed)" and "remaining: engine + driver +
  transfer".
- Embedded bars carry "in process: nothing removed; includes client
  fetch".
- List the queries dropped from the net view, with reasons.

**Label every figure.** The clock goes in:

- the summary sentence and chart titles
- social preview images
- CSV and JSON exports, as two columns: `round_trip_estimate_ms` (the
  amount removed) and `net_estimated_ms`, next to `end_to_end_ms`
- the SQL view names

**Comparability receipt.**

- Add a *Transport* field from `endpoint_class`: in process, localhost,
  network or unknown. This fixes the in-process vs localhost match.
- Rewrite the locality summary to say why a difference matters, for
  example: "End-to-end times include client round trips for networked
  runs only."
- Show `timing_method`, `net_estimate_status`, and the floor's min,
  median, spread and `probed_at`.
- For ineligible networked runs, a neutral line: "Round trip not
  estimated for BigQuery: its probe runs a full job."

**Methods page.** Every *(estimated)* label links to a methods page.
A short follow-up to the Results Explorer introduction post announces
it. The page covers:

- the formula and what is and is not removed;
- the eligibility rules and the per-adapter probe check results;
- the 10% rule and why it exists;
- a worked example from a real method-2 run: `ms`, the floor's min and
  median, `request_count`, `net_ms`, and the bundle's `platform_ms` for
  comparison.

### Latency sensitivity

Fixed share bands that label or rank runs ("25% is latency-bound") stay
rejected. They resemble the bands the ADR rejects, and they misfire on
BigQuery.

Instead, on the default end-to-end view of a cohort where `net` is
available, compare the result with the *round trip removed* view:

- A per-query winner counts as flipped only when the net difference
  exceeds the uncertainty margin, `request_count × (floor median −
  floor min)` for the runs involved. Smaller differences are estimate
  ties.
- The headline flips only when it flips under the min floor. Because
  the min under-corrects, such a flip is robust, and the copy says so.
- If anything flips, say so on the end-to-end view: "This result
  changes when client round trips are removed; 7 of 22 queries flip."
  Then link to the `net` view.

Show a scale-factor hint on a mixed-transport compare when the flip
notice fires, or when the view is unavailable for a networked run:
"At this scale, client round trips are a large share of query time;
try a larger scale factor."

### Statistics

- Coverage has one definition: the existing evidence gates (at least 2
  shared queries, and at least 50% valid per run). Round-trip-dominated
  queries do not count against them.
- Per-query wins inside the tie band (`COMPARE_TIE_THRESHOLD`) are ties
  in both views.

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
| 0 | Core | Amend the locality ADR. A labeled, opt-in estimate that removes the measured round trip is allowed on Compare, shown with end-to-end time and never the default, for adapters that pass the probe check. The 10% round-trip-dominated rule is named as a reliability floor inside that view. Fixed latency bands that label or rank runs stay rejected. Platform timings are captured and published in result bundles. Record the outcome of the terms check. | Owner decision (agreed). |
| 1 | Core | Schema 2.4: timer scope fixes, `timing_method`, `request_count`, result size, `probed_at`, `platform_timing` (including the probe's), ID-based capture, stream ID in Snowflake tags, `net_estimate_status`. Snowflake, BigQuery and Redshift first, then Athena, Databricks, Trino and ClickHouse; check MotherDuck. Conformance tests and the probe check per adapter. Method-2 runs held out of publication. | Schema bump. Site local preview accepts 2.4 first. Changelog note. |
| 2 | Core, then replay | Read model 17: `request_count`, `timing_method`, `endpoint_class`, `net_estimate_status`, probe sample count and time. `timing_method` in Compare and leaderboard cohorts. The Transport receipt field and rewritten locality text. Then release method-2 runs to the corpus. | Read model 17 from core first. Digest approval. |
| 3 | Core | Re-run the canonical corpus with method 2. | Runs for the launch set. |
| 4 | Core, then replay | The *round trip removed* view on Compare (`clock=net`), with its sentence, columns, stacked bar, flip notice, scale-factor hint, exports and methods page. | Launch set in place: method-2 local and cloud TPC-H at SF1 and SF10. |
| Later | Core, then replay | Platform timings in the Explorer, if needed. | Its own design pass. |

## Rejected alternatives

- **Removing the round trip by default:** the headline would rest on an
  estimate, and it would hide stalls on the default view. It stays
  opt-in.
- **Subtracting the median floor:** the median can exceed the round trip
  a given query actually paid, so it can over-correct. The min is used,
  and the median only bounds the range shown.
- **A per-query round-trip count:** never an agreed metric. A count of
  requests the adapter sent is a plain fact the adapter already knows.
- **Counting SQL statements by parsing the text:** drivers differ.
  Redshift sends a multi-statement text as one request, so a parsed
  count would subtract too much.
- **Locking out only BigQuery:** the probe includes server work on most
  cloud services. One rule, the probe check, applies to every adapter.
- **The round-trip view on leaderboards:** ranks are computed in core,
  and one ineligible run would complicate a whole board. Leaderboards
  stay end-to-end.
- **Classifying DuckLake on S3 as networked:** its probe is an
  in-process `SELECT 1`, which removes none of the S3 latency, and core
  has no detected storage backing. Embedded runs stay end-to-end.
- **Switching the default view by cohort:** links and rankings would
  change meaning as runs were added, and Compare and leaderboards would
  disagree.
- **Fixed latency bands that label or rank runs:** named bands by
  another name. The 10% rule is different: it only removes unreliable
  estimates from the opt-in view.
- **Dropping short queries from end-to-end winner claims below a
  duration threshold:** hides real data, and the threshold invites
  tuning to a result.
- **Keeping round-trip-dominated queries at a clamped value as a
  robustness line:** the clamped values are the unreliable ones, so a
  line built on them adds noise, not robustness.
- **DuckDB profiler time for embedded runs:** with client and engine on
  one machine there is no network latency to remove.
- **Re-probing during long runs:** not worth the extra code for now. The
  floor-suspect check catches a floor larger than measured time.
- **Reusing the stats Snowflake collects today:** matched by tag, so
  they can belong to another stream or to `COMMIT`.
- **The clock as part of the `basis` token or `available_bases`:** breaks
  the token grammar, and today's Explorer would read every row as
  answering every basis. Separate fields are used.

## Open questions

None. Platform timings in the Explorer are deferred, not open.
