# Outline: Why BenchBox ships its own SQLGlot fork

> Dialect translation bugs changed benchmark answers, so BenchBox now carries its
> own SQLGlot fork inside every release. We maintain the fork permanently, track
> upstream releases, and offer the generally useful fixes back.

**TL;DR**: BenchBox runs the same benchmark SQL on many engines, and translation
bugs changed the values some of those runs reported. Since v0.5.0 every install
translates SQL with `benchbox-sqlglot`, a permanent fork of SQLGlot that ships
inside the `benchbox` wheel. Its behavior is proven by running translated SQL on
ten real engines, and the published results that used the old SQL are marked and
being rerun. The v0.5.0 release post gave this one paragraph; this is the long
version.

---

## Metadata

```yaml
title: "Why BenchBox ships its own SQLGlot fork"
series: building-benchbox
post_number: 20
type: architecture-design
status: published (blog/2026-11-07-why-benchbox-ships-its-own-sqlglot-fork.md)
tags: [benchbox, sqlglot, sql, transpilation, dialects, ddl, fork, architecture]
updated: 2026-11-06
```

## Post definition

| Field | Decision |
|---|---|
| Thesis | SQL translation decides whether BenchBox results are correct, so we now own that layer. The fork is permanent, BenchBox's transpilation goes through it, every SQL platform resolves to a declared dialect, and DDL gets the same care as queries. Generally useful fixes still go upstream; correct BenchBox results no longer wait on upstream review. |
| Audience | BenchBox users who read the v0.5.0 post and want the reasoning. Secondarily, teams adding or tuning a platform in BenchBox, and maintainers weighing a permanent fork of a dependency |
| Tone | `we`, plain, claims tied to a number or a named condition. No em-dashes. Neutral on SQLGlot upstream: their decisions were reasonable for their project |
| Publication state | Shipped. BenchBox v0.5.0 (released November 5, 2026) bundles `benchbox-sqlglot` 30.29.0.1, built on SQLGlot 30.29.0. Write every section in the past or present tense; nothing here is direction |
| Relation to post 21 | [Post 21](../../../blog/2026-11-06-v0-5-0-release-overview.md) is published and already carries the TPC-DS Q78 integer-division image, the 25 removed / 58 added Explorer figures, and the "engines whose SQL changed" list. Link it once in the opening; do not repeat its image or its migration table |
| Relation to post 11 | Post 11 (unpublished draft) catalogued the layer BenchBox built on top of SQLGlot. This post is what became of that layer. Do not link it unless it is on `main` at publication |
| Title | "Soft" is dropped. The fork carries fork-only modules and is maintained indefinitely; "soft fork" undersold it |

## Section plan

### TL;DR (~60 words)

As above.

### 1. Translation is where benchmark correctness is won or lost (~250 words)

- BenchBox runs TPC-H, TPC-DS and other workloads on many engines and compares
  answers. The comparison means something only if translated SQL keeps its
  meaning.
- Open with one real query, wrong output beside right output. Use the TPC-H
  Q6-style bounds `BETWEEN 0.06 - 0.01 AND 0.06 + 0.01`: ClickHouse and SQLite
  evaluated the bounds as Float64 and silently dropped the rows with discount
  exactly 0.07. On DataVault Q6 at SF 0.01 the revenue sum was 734,493.73 before
  the fix and 1,193,053.23 after, matching DuckDB (corpus notes, 2026-10-24
  audit). Post 21 used Q78; do not reuse it here beyond a one-clause pointer.
- The pattern across the work: each bug ran without error and returned a
  plausible, different answer. Short list, one line each:
  - integer division truncated ratios on SQLite and DataFusion;
  - DataFusion was translated as PostgreSQL, so `NOT IN` and division followed
    the wrong rules;
  - ClickHouse decimal division and `ROLLUP` keys returned different values;
  - SQLite and QuestDB turned unpadded date literals such as `'1999-5-01'` into
    NULL, so date filters matched nothing.
- DDL has the same problem with higher stakes: a mistranslated `CREATE TABLE`
  changes the physical design being measured, not just a number.

### 2. Why we now own the translation layer (~300 words)

- Some bugs could not be repaired from BenchBox: once a parser discards a type or
  a fractional part, rewriting the generated SQL cannot restore it.
- BenchBox had grown its own layer of text fix-ups, adapter rewrites and a DDL
  rewrite registry on top of SQLGlot. Fixes landed in whichever layer was handy,
  so the same rule could live in three places.
- Waiting on upstream review put our releases behind decisions we do not control.
  A benchmark tool cannot ship known-wrong SQL while a fix waits in a queue.
- Upstream also declined the direction of some of the work, for good reasons of
  their own. The SQLite date-arithmetic lowering (upstream issue #8347, closed as
  not planned) and a QuestDB dialect (#8348, declined) are the two recorded
  cases. Present these neutrally: SQLGlot is a general transpiler; BenchBox needs
  benchmark-exact semantics on engines SQLGlot does not target.
- So the fork is permanent. We track upstream releases and adopt them on our
  schedule.
- Upstream is still where generally useful fixes belong. State the ledger
  exactly, because it is smaller than "we upstream everything":
  - one BenchBox fix merged upstream (SingleStore percentile ordering, tobymao/sqlglot #8352);
  - two upstream fixes by other contributors carried ahead of a release
    (#8325, #8440); a third (#8247) overlaps a fork change but the fork's wider
    nested-field handling is not claimed equivalent;
  - four patches fork-only by policy (`platform-dialects`,
    `postgres-exact-division`, `sqlite-exact-integer-division`,
    `sqlite-grouping-sets`), because they encode BenchBox's exactness rules or
    register dialects upstream does not want;
  - the remaining carried patches (24 entries in the manifest at 30.29.0.1) are
    recorded as not yet offered. Say so. The commitment is to offer what is
    general, not to have offered everything.

### 3. What moved into the fork (~400 words)

This is the news. Shipped in v0.5.0.

- **One home for transpilation.** BenchBox reaches the translator through a few
  entry points: query translation, named rewrites, DDL translation, and loading
  the bundled runtime. A test fails the build if new code calls the translator
  any other way.
- **What left BenchBox.** The post-translation text fix-ups and the per-platform
  rewriters that patched generated SQL strings are gone, with one exception kept
  deliberately (a StarRocks `ORDER BY` alias rewrite that runs after generation).
  BenchBox still carries about twenty named rewrites, but they operate on the
  fork's parse tree, live in one registry, and are applied by name; the DDL
  registry remains only as a record of which rules apply where, and the rewriting
  itself happens in the fork. Be precise here: "moved the rules out of string
  patching" is true, "deleted every rewrite" is not.
- **A declared dialect for every SQL platform.** The platform manifest is the one
  place that maps a platform to its dialect, and a test pins all 49 SQL
  platforms. The fork added dialects for DataFusion, QuestDB, Netezza, Vertica
  and Greenplum, which BenchBox previously approximated through PostgreSQL.
  Athena and SingleStore now generate in their own dialects too (Athena text is
  pinned equal to Trino's).
- **Safer defaults.** An unknown platform or dialect is an error instead of
  silently running the untranslated SQL. Multi-statement queries translate every
  statement, not only the first.
- **DDL as a translation target.** `CREATE TABLE` translation covers types,
  keys, partitioning, clustering and storage layouts per platform, for example
  BigQuery `BIGNUMERIC` for wide decimals, SingleStore `VECTOR(n, F32)` columns
  and Databricks primary keys without ordering modifiers.
- **Fixes that landed between the first fork runtime and 30.29.0.1**, one line
  each, to show the fork is a working repository and not a snapshot: SQLite
  global aggregates without `GROUP BY ()`, SQLite `PIVOT`/`UNPIVOT` and
  `ORDER BY ALL`, source NULL ordering preserved in positional, window and
  aggregate order keys (TPC-DS Q49, Q51, Q74), Spark and Databricks regex
  replacement groups and sub-day `DATE_TRUNC`, SingleStore JSON array indexes,
  QuestDB and DataFusion date-literal padding.
- **TPC-DS OBT rebuilt.** The one-big-table variant used a query converter that
  drifted from TPC-DS. It is now a hand-owned catalog that runs 90 of the 99
  queries and records why each of the other 9 is excluded. One paragraph; it may
  deserve its own post.

### 4. How we know it is right (~250 words)

- Every behavior in the fork is proven by running translated SQL on a real
  engine where one is available. Fork CI runs ten engines: SQLite, DuckDB,
  DataFusion, ClickHouse (chDB) and Spark in-process; PostgreSQL, Trino,
  QuestDB, StarRocks and Doris as containers pinned by image digest.
- BenchBox additionally executes all 22 TPC-H and 99 TPC-DS queries at SF 0.01
  on SQLite, DuckDB, DataFusion and PostgreSQL and requires every difference
  from the reference engine to carry an explanation; a stale explanation fails.
- Engines with no CI option have translation-corpus evidence instead, and the
  fork publishes the gap list (`downstream/ENGINE-GAPS.md`): the cloud
  warehouses, Athena (Trino stands in), SingleStore (its dev container needs a
  license), Netezza, Greenplum and Vertica. Say so plainly.
- One honest lesson: an equality check can pass vacuously. The unpadded date
  bug survived because at SF 0.01 the affected queries return no rows on the
  reference engine either. Checks now need non-empty evidence or a recorded
  reason.

### 5. What this means for published results (~250 words)

- On 2026-10-24 we compared the SQL generated by v0.4.1 and by the fork for
  every published bundle: 124 bundles had run SQL that has since changed; 43 of
  those had wrong rows or values, or queries that failed and now run. The rest
  differ only in timing or SQL text.
- Bundles with wrong values are marked and excluded from rankings until rerun.
  20 needed a new marker; the others already carried one for an unrelated
  defect. Notes in the results corpus record the cause for every affected group.
- Where it stands at v0.5.0 (corpus notes reconciliation): 73 of the 124 have
  been replaced by a rerun, 4 are flagged and not replaced (one ClickHouse
  Server bundle whose engine is unavailable, three cloud OBT bundles not rerun
  for cost), 47 are note-only. Superseded bundles stay in the corpus, labelled
  and unranked. Post 21 states the Explorer-facing figures (25 removed from
  rankings, 58 replacements for ClickHouse Local, DataFusion and SQLite); cite
  those as the release figures and the 124/43/73 as the audit figures, and do
  not derive one from the other in the text.
- Point readers at how a flag looks in the Results Explorer: the ranking row
  carries an asterisk with the exclusion reason on hover.

### 6. What changes for users (~200 words)

- Nothing to install or configure. The fork ships inside the `benchbox` wheel
  as a zip under `benchbox._vendor` with its MIT license; the public `sqlglot`
  package is no longer installed. Every install of a release translates SQL
  identically, and every result records the translator version.
- A user's own SQLGlot is untouched. Both packages install, upgrade and uninstall
  independently; we test that on macOS, Linux and Windows.
- Startup is faster as a side effect: SQLGlot loads on the first translation,
  and `benchbox run` loads one adapter.
- Rerun workloads on SQLite, DataFusion and ClickHouse after upgrading; those
  engines saw value-changing fixes. Post 21 has the full list of engines whose
  SQL changed; link, do not repeat.
- Small measured costs, stated with conditions. The only recorded numbers are
  from runtime 30.23.0.2 on one Mac: wheel 9.40 MB to 10.18 MB (+8.3%); first
  import plus one translation 373 ms median from the zip against 70 ms from an
  unpacked wheel. Re-measure on 30.29.0.1 before drafting or leave the numbers
  out.

### 7. Staying current, in brief (~120 words)

- Upstream tagged 155 commits between v30.24.0 and v30.29.0. We merge each
  upstream release into the fork as one reviewed pull request, after the
  real-engine tests pass, and BenchBox adopts the resulting wheel by digest as
  one reviewed change that links the fork diff.
- A scheduled job in the fork prepares the upstream refresh; merging and
  adoption stay human decisions.
- A release check queries the OSV advisory database for the pinned upstream
  version and blocks the release on a match, so an upstream security fix reaches
  users through a fork refresh and a BenchBox release.
- Each upstream merge is also where generally useful changes get prepared for
  submission upstream.

### 8. Limitations and commitments (~150 words)

- Maintaining a fork is a real, permanent cost. We state it openly.
- Engine coverage gaps: cloud warehouses, SingleStore, Netezza, Greenplum and
  Vertica are verified from translation output, not execution.
- Most carried patches have not yet been offered upstream; the manifest records
  each one's status.
- SQLGlot security fixes reach users through BenchBox releases, so our release
  cadence carries that responsibility.
- Scope: the fork is a translation layer. Benchmark definitions, execution and
  result validation stay in BenchBox.

### 9. What to do next (~80 words)

- Upgrade to v0.5.0 and rerun SQLite, DataFusion and ClickHouse workloads.
- Report translation problems with source dialect, target dialect and the query.
  DDL examples are especially welcome.
- Follow the fork at `BenchBox-dev/benchbox-sqlglot` (public): patch manifest,
  engine gap list, maintenance guide.

### References (short)

- Fork (public): https://github.com/BenchBox-dev/benchbox-sqlglot, with
  `downstream/patches.json` (patch manifest, 24 entries at 30.29.0.1),
  `downstream/ENGINE-GAPS.md` and `downstream/MAINTAINING.md`. No PyPI project;
  the wheel ships inside `benchbox`.
- Upstream base for the shipped runtime: SQLGlot v30.29.0
  (https://github.com/tobymao/sqlglot/compare/v30.24.0...v30.29.0 for the delta)
- Upstream: tobymao/sqlglot PR #8352 (BenchBox fix, merged); PRs #8325, #8440
  (carried upstream fixes by other contributors); PR #8247 (overlap, not
  carried); issues #8347 (closed, not planned), #8348 (QuestDB declined)
- Fork refresh example: benchbox-sqlglot PR #80 (v30.29.0 integration);
  BenchBox adoption: BenchBox-dev/BenchBox PR #3932
- Published: [Post 21](../../../blog/2026-11-06-v0-5-0-release-overview.md)
- Internal, not to be linked: `_project/decisions/sqlglot-fork-transpilation-plan.md`
  (supersedes the bounded framing in `sqlglot-soft-fork-plan.md`),
  `_project/decisions/sqlglot-maintenance-decision-record.md`,
  `results-data/CORPUS_NOTES.md` (audit ledger and count reconciliation)

## Drafting notes

- The tension to hold throughout: permanent fork, generous upstreaming. Neither
  half works alone, and the upstreaming half is a commitment with one merged
  example so far; write it at that size.
- Write Section 1 first, around the Q6 bounds example. Section 5 is the part
  readers will act on; keep its numbers exact and keep the release figures and
  audit figures in separate sentences.
- Do not name internal gates, waiver files, Make targets or workflow names.
  Readers need the commitment and the evidence, not the machinery.
- Verified 2026-11-06 against the fork `main` and BenchBox `develop`: runtime
  30.29.0.1 on v30.29.0; 24 manifest entries; upstream PR and issue states;
  ten CI engines and the gap list; 49 SQL platforms in the dialect map; Windows
  packaged-runtime verification passed; corpus counts 124/43/20 and 73/4/47;
  Q6 revenue sums.
- Verify again before drafting:
  - package size and import time on 30.29.0.1 (only 30.23.0.2 numbers exist);
  - the corpus counts, since local reruns continue;
  - whether post 11 is published (link only if it is);
  - whether the fork's scheduled refresh has started merging on its own (the
    controller merged on 2026-11-06 is off by default); Section 7 says merging
    is a human decision and must change if that flips;
  - the upstream status of any patch offered since 2026-11-06.
- Series plan row added 2026-11-06 (status OUTLINED).
