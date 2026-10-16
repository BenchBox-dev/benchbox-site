# Comparing Local and Cloud Runs: Round-Trip Latency

How the Explorer should compare an in-process run (DuckDB, Polars) with a
networked run (Snowflake, BigQuery), and when it should leave client
round-trip time out of the comparison.

## Problem

Every published query time is the client's end-to-end wall clock. That
means different things on each side of a local-vs-cloud comparison:

| Run | What `ms` covers |
| --- | --- |
| DuckDB (in process) | Engine work plus the Python fetch. No network. |
| Snowflake | Cursor setup, an `ALTER SESSION SET QUERY_TAG` round trip, the query round trip, queue, compile, execute, and result transfer. Multi-statement queries add `BEGIN` and `COMMIT` round trips. |
| BigQuery | SQL rewrite, job submit, job wait, and result fetch. |
| TPC power and throughput tests | All of the above, plus query text generation from the seed, because the outer timer starts before `get_query`. |

Sources in core: `benchbox/platforms/snowflake.py:1144-1192`,
`benchbox/platforms/bigquery.py:1540-1566`,
`benchbox/core/tpch/power_test.py:213-265`.

For long queries the overhead is noise. For short ones (SF0.01 to SF1,
queries under about 100 ms) it can be most of the number. A DuckDB vs
Snowflake compare at SF1 then mostly measures the network, not the engine.

### What exists today

- **Per query:** one time, `duration_ms`, which becomes `display_ms`.
  There is no engine or server time field.
- **Per run:** a round-trip floor, `statement_overhead_{min,median}_ms`.
  It comes from 1 warmup plus 5 `SELECT 1` calls after the run, under
  `environment.client_link`.
- **Engine stats collected but discarded:** the Snowflake adapter reads
  `QUERY_HISTORY` (`total_elapsed_time_ms`, `execution_time_ms`,
  `compilation_time_ms`). BigQuery keeps job timestamps and `slot_ms`.
  Redshift reads `sys_query_history` duration. The export drops all of
  these: they sit in `LEGACY_IGNORED_EXTRA_FIELDS`, and schema 2.3 has no
  slot for them.
- **Measurement basis** covers only passes and statistic
  (`measurementBasis.ts`). There is no clock axis.
- **Locality receipt** (`ComparabilityReceipt.tsx:260-343`) warns on
  cross-cloud and cross-region runs. A local run counts as a "match" with
  a collocated cloud run, so DuckDB vs Snowflake gets no warning at all.
- **Core ADR** `adr-client-link-locality-disclosure.md` says: "Disclose
  the topology; do not infer the distance." It rejects subtracting latency
  from reported timings.

## Options

### A. Disclose only (status quo, plus a fix)

Keep end-to-end time. Add a transport mismatch warning for the gap above.

- Pro: no new data, and it matches the ADR.
- Con: the headline winner on short queries stays a network result. A
  warning does not tell the user how big the effect is.

### B. Subtract the measured floor

Compute `net_ms = max(ms - k * statement_overhead_median_ms, floor)` in
the browser.

- Pro: works on today's snapshot, with no core change.
- Con: it is a guess, and the ADR rejects it.
  - `k` differs by adapter: 2 for Snowflake (tag plus query), more with
    `BEGIN`/`COMMIT`.
  - `SELECT 1` does not cover result transfer.
  - The floor is per run and taken after the run, so it misses drift
    during the run.
  - Near-zero results blow up ratios and geomeans.
  - It can hide real driver or engine stalls.

### C. Publish an engine clock

Add a per-query `engine_ms`, reported by the platform, to the result
schema. Offer it as a second clock in the Explorer.

- Pro: it is measured, not inferred, so it fits the ADR (it is more
  disclosure, not an adjustment). `ms - engine_ms` gives a real
  per-query transport time. It also fixes cloud vs cloud cross-region
  compares.
- Con: needs a schema bump in core, adapter work, and a read model bump.
  Coverage will be partial at first, and each platform defines "elapsed"
  a little differently.

### D. Shrink the overhead at the source

Move work that is not the query out of the timer:

- Snowflake: set the query tag before the timer starts.
- TPC drivers: generate the query text before the timer starts.
- Plan capture: always defer it to its own phase.

- Pro: makes end-to-end time more honest for every platform, with no UI
  change.
- Con: the true network round trip remains. It changes published numbers,
  so it needs a snapshot digest approval.

## Recommendation

Do D, then C, with A's warning as the fallback. Do not ship B as a basis.

1. **D first, in core.** These are measurement bugs, not policy. Add a
   changelog note, since short-query cloud times will drop.
2. **C: an engine clock, as a second clock.** End-to-end stays the
   published default, and engine time is an opt-in lens.
3. **Use the floor only as a diagnostic.** Show "round-trip share", meaning
   floor / `display_ms`, per query. Flag queries where it is 25% or more as
   *latency-bound*. This works on today's data and fits the ADR.
4. **Defaults:**
   - Single-run pages, leaderboards, and same-transport compares default
     to end-to-end.
   - A compare that mixes transports (in-process or localhost vs network)
     defaults to engine time, but only when every run in the cohort has
     engine time for the shared queries.
   - If any run lacks it, stay on end-to-end, show the transport warning,
     and show the latency-bound flags.
   - Any user choice wins, and is kept in the URL.

Why default to engine time only for mixed-transport compares? The person
who picks DuckDB and Snowflake side by side is asking "which engine is
faster". Leaderboards and run pages answer "what would I see from a
client", where end-to-end is the honest number.

## Design

### Core schema (2.4)

Per query, next to `ms`:

| Field | Type | Meaning |
| --- | --- | --- |
| `engine_ms` | number, optional | Time from the platform accepting the statement to the result being ready, as the platform reports it. Includes queue and compile. Excludes result transfer to the client. |
| `queue_ms` | number, optional | The queued part, when reported. Lets the UI show it on its own. |

Per run, `run.engine_clock`:

- `source`: for example `snowflake.query_history.total_elapsed_time`,
  `bigquery.job.end_minus_creation`, or `in_process`.
- `coverage`: the share of measured queries that have `engine_ms`.

Rules:

- **Validity:** drop `engine_ms` when it exceeds `ms * 1.05 + 5 ms`
  (clock skew), and record the reason. Never fill it in from `ms` for a
  networked platform.
- **In-process engines** (DuckDB, Polars, DataFusion, pandas): set
  `engine_ms = ms` with source `in_process`. There is no transport to
  remove. The Python fetch stays in both clocks; disclose this, since it
  slightly favors cloud engines on large results.
- **Localhost servers** (CedarDB, Postgres, local ClickHouse): use the
  server's own stats where they exist. Otherwise leave `engine_ms` out.

### Adapter sources

Check each source against the live platform before using it.

| Platform | Source for `engine_ms` | Today |
| --- | --- | --- |
| Snowflake | `QUERY_HISTORY.TOTAL_ELAPSED_TIME` by query ID; `QUEUED_*` for `queue_ms` | Collected, then dropped. The lookup often returns only a note because `max_retries=0`. Collect `sfqid` per query and look them all up in one batch after the run. |
| BigQuery | job `end_time - creation_time`; `start_time - creation_time` for `queue_ms` | Timestamps collected, then dropped. |
| Redshift | `SYS_QUERY_HISTORY.elapsed_time` and `queue_time` | Duration collected, then dropped. |
| Databricks SQL | query history `total_duration_ms` | Not collected. |
| Athena | `TotalExecutionTimeInMillis`, `QueryQueueTimeInMillis` | Not collected. |
| Trino / Presto | query info `elapsedTime`, `queuedTime` | Not collected. |
| ClickHouse | `system.query_log.query_duration_ms` | Not collected. |
| MotherDuck | none known | Leave it out. Engine clock compares lock MotherDuck out. |

### Snapshot read model

- `query_executions` gains `engine_ms` and `queue_ms`.
- `query_display_timings` gains `display_engine_ms`, the median over the
  same passes as `display_ms`, plus its own validity and exclusion reason.
- `result_basis_availability` gains `available_clocks`
  (`end_to_end`, `engine`).
- Bump `EXPECTED_READ_MODEL_VERSION`. Per `AGENTS.md`, support N and N-1.
  An N-1 snapshot reports only `end_to_end`.

### Explorer

**The basis token gets a clock axis.**
`MeasurementBasis = { passes, statistic, clock }`, serialized as
`all_warm:median:engine`. Leave out `:end_to_end` so today's URLs stay
valid. This reuses the existing `basesEqual`, `lockCrossRunBasis`,
`formatBasisLabel` and `?basis=` plumbing.

**`MeasurementBasisBar`** gets a third select, Clock: *End to end* or
*Engine*.

- Disable the Engine option, with a reason, when any run in the cohort
  lacks it.
- Copy on Engine: "Engine time from each platform's own stats. Client
  round trip and result transfer are excluded."

**Resolved defaults are written to the URL.** When the page picks Engine
for a mixed-transport cohort, write `basis=…:engine` explicitly. A shared
link must not change its meaning when new runs arrive.

**`resolveResultsForBasis`** reads `display_engine_ms` / `engine_ms` on
the engine clock, and recomputes `display_geomean_ms` over shared
queries. It nulls the same fields as today's non-default bases:

- `power_score` and `throughput_at_size`, because TPC defines them on the
  end-to-end clock.
- Cost. Warehouse billing follows uptime, not engine time, so cost per
  engine-second would mislead.

**Cohort lock.** Mixed clocks are refused just like mixed passes: "One
run's clock against another's measures the clock, not the platform."

**`ComparabilityReceipt`** gets a *Transport* field: `in_process`,
`localhost`, or `network`. Derive it from `platform.deployment` and
`endpoint_class`, following `facet-environment-migration.md`.

| Clock | Transports | Receipt shows |
| --- | --- | --- |
| End to end | Mixed | Warning: "Local vs networked: end-to-end times include round trip (floor X ms) for networked runs only." |
| Engine | Mixed | Info: "Round trip excluded." |

**`CompareSummary`.** On mixed transports with the end-to-end clock:

- Count the latency-bound queries.
- When winner claims rest mostly on them, say so: "7 of 22 queries are
  latency-bound for Snowflake".
- Link to the Engine clock when it is available.

**Per-query chart.** On any run with both clocks, show `ms` as a stacked
bar: engine time, then transport (`ms - engine_ms`). This makes the
round trip visible, not just excluded.

### Edge cases

- **Throughput tests:** engine time per query is valid, but throughput
  stays a wall-clock metric. Keep it on end-to-end only.
- **Result cache:** an engine clock makes a cached result look free.
  Core should check that the result cache is off (Snowflake
  `USE_CACHED_RESULT`, BigQuery `useQueryCache`) and record it in the run.
- **Queue time:** keep it in `engine_ms`, since an undersized warehouse
  is the platform's cost. Show `queue_ms` on its own when reported.
- **Partial coverage inside a run:** the engine clock uses the shared
  query set. The existing evidence gates still apply: at least 2 queries,
  and at least 50% valid per run.

## Rollout

| Phase | Where | Work | Needs |
| --- | --- | --- | --- |
| 1 | Site | Transport receipt field and warning. Latency-bound flags from the floor. | Existing data only. |
| 2 | Core | Option D measurement fixes. | Snapshot digest approval, changelog note. |
| 3 | Core | Schema 2.4 `engine_ms` and `queue_ms`. Snowflake, BigQuery and Redshift first. Amend the locality ADR: an engine clock is disclosure, not subtraction. | Schema bump. |
| 4 | Core then site | Read model fields, then the clock axis, defaults, and stacked bars in the Explorer. | Read model bump, then a replay into `explorer/`. |
| 5 | Core | Databricks, Athena, Trino and ClickHouse sources. | Per-adapter checks. |

## Open questions

1. Should leaderboards that mix transports also default to the engine
   clock when coverage is complete, so they agree with Compare?
2. Is a 25% round-trip share the right latency-bound threshold?
3. Should Snowflake `engine_ms` use `TOTAL_ELAPSED_TIME`, or
   `EXECUTION_TIME + COMPILATION_TIME` to leave out cloud-services
   overhead? This doc assumes total elapsed, to match "includes queue
   and compile".
