---
blogpost: true
date: November 7, 2026
author: Joe Harris
series: building-benchbox
post_number: 20
type: architecture-design
tags: benchbox, sqlglot, sql, transpilation, dialects, ddl, fork, architecture
meta_description: "Translation bugs changed benchmark answers, so BenchBox v0.5.0 bundles a permanent SQLGlot fork, proven on ten engines, and flags results that ran the old SQL."
---

# Why BenchBox ships its own SQLGlot fork

> SQL dialect translation bugs changed benchmark answers, so BenchBox now carries its own SQLGlot fork inside every release. We added dialects for DataFusion, QuestDB, Greenplum, etc. We maintain the fork permanently, track upstream releases, and offer the generally useful fixes back.

**TL;DR**: BenchBox runs the same benchmark SQL on many engines, and translation bugs changed the values some of those runs reported. Since v0.5.0 every install translates SQL with `benchbox-sqlglot`, a permanent fork of SQLGlot that ships inside the `benchbox` wheel. Its behavior is proven by running translated SQL on ten real engines, and the published results that used the old SQL are marked and being rerun. The [v0.5.0 release post](./2026-11-06-v0-5-0-release-overview.md) gave this one paragraph; this is the long version.

---

![Flow diagram. Benchmark SQL, written once (TPC-H 22 queries, TPC-DS 99 queries, DDL and more), enters BenchBox through four entry points and is translated by benchbox-sqlglot 30.29.0.1, which ships inside the benchbox wheel and is made of upstream SQLGlot v30.29.0, 24 carried patches and 5 added dialects. Upstream releases are merged in and general fixes offered back. The output is translated SQL in one declared dialect per platform, 49 platforms in all. A bottom band reads "Proven by running it, not by reading it": fork CI runs ten real engines, five in-process and five in containers pinned by digest, and BenchBox CI runs all 22 TPC-H and 99 TPC-DS queries at SF 0.01 on SQLite, DuckDB, DataFusion and PostgreSQL with every difference explained.](./images/sqlglot_fork_translation_flow.png)

## Translation is where benchmark correctness is won or lost

BenchBox runs TPC-H, TPC-DS and a dozen other benchmark workloads across many data platforms and compares the answers. Comparisons are only valid if the translated SQL means what the benchmark intended. BenchBox writes each query once and translates it to the target dialect with SQLGlot[^sqlglot]. So SQLGlot affects every benchmark definition and every published number. 

Here is an example query that was wrong. TPC-H Q6 filters on a discount band, and the DataVault variant (BenchBox's Data Vault 2.0 modelling of the TPC-H schema, with the 22 queries adapted to it) spells the bounds as arithmetic:

```sql
WHERE l_discount BETWEEN 0.06 - 0.01 AND 0.06 + 0.01
```

The band is 0.05 to 0.07 inclusive. ClickHouse and SQLite evaluated `0.06 + 0.01` in floating point, got `0.06999999999999999`, silently dropping rows with a discount of exactly 0.07. On DataVault Q6 at scale factor 0.01 the revenue sum was 734,493.73 on the old SQL and 1,193,053.23 after the fix, matching DuckDB. No error, no warning, a plausible number that was wrong by 38 percent.

That pattern repeated across the work: each bug ran cleanly and returned a different answer.

- Integer division truncated ratios on SQLite and DataFusion. The v0.5.0 post shows TPC-DS Q78 reporting 2.0 where the ratio is 2.32.
- DataFusion was translated as PostgreSQL, so division followed PostgreSQL's rules, and `NOT IN` subqueries planned badly enough to need a rewrite to `NOT EXISTS`.
- ClickHouse decimal division and `ROLLUP` keys returned different values from the reference engine.
- SQLite and QuestDB turned unpadded date literals such as `'1999-5-01'` into NULL, so the date filters matched nothing.

DDL is even more critical. A mistranslated `CREATE TABLE` changes the physical design being measured, from the column data types to the partitioning and clustering keys.

## Why we now own the translation layer

Some of these bugs could not be repaired from BenchBox at all. Once a parser has discarded a column type or folded a decimal into a float, nothing BenchBox does to the generated SQL string can put the information back. The fix has to happen inside the translator.

BenchBox had been working around that for a while. By v0.4.x it carried its own layer of post-translation text fix-ups, per-adapter rewrites and a DDL rewrite registry on top of SQLGlot. Each fix was added to the code closest to the effect, so similar post-translation rules could end up in several places.

SQLGlot is a general-purpose transpiler, and its maintainers review changes on their own schedule and against their own goals. A benchmark tool cannot ship SQL it knows to be wrong while a fix waits in a review queue. Upstream SQLGlot also declined the direction of some of the work, for reasons that make sense for their project: the SQLite date-arithmetic lowering BenchBox needs was closed as not planned (tobymao/sqlglot issue #8347), and a QuestDB dialect was turned down (#8348)[^upstream-issues]. BenchBox must have benchmark-exact semantics even on data platforms SQLGlot does not support.

So the fork is permanent. We track upstream releases and adopt them on our schedule, and we do not plan to retire the fork when some set of patches lands upstream.

Upstream SQLGlot is still where generally useful fixes belong, and we will continue to offer our generally useful fixes there for SQLGlot's consideration. One BenchBox fix is merged in SQLGlot: SingleStore percentile ordering (PR #8352). The fork carries two upstream fixes by other contributors ahead of their release (#8325 and #8440); a third (#8247) overlaps a fork change, but the fork's wider handling of nested fields is not claimed to be equivalent. Four patches are fork-only by policy, because they encode BenchBox's exactness rules or register dialects upstream does not want: `platform-dialects`, `postgres-exact-division`, `sqlite-exact-integer-division` and `sqlite-grouping-sets`. The patch manifest at runtime 30.29.0.1 lists 24 carried patches, and most of the rest are recorded as not yet offered[^manifest]. 

## What moved into the fork

BenchBox v0.5.0 ships `benchbox-sqlglot` 30.29.0.1, built on SQLGlot 30.29.0. Here is what changed on the BenchBox side.

**One home for transpilation.** BenchBox reaches the translator through four entry points: query translation, named rewrites, DDL translation, and loading the bundled runtime. A test fails the build if new code calls the translator any other way, so a future fix cannot quietly grow a fifth path.

**Rules left the string layer.** The post-translation text fix-ups and the per-platform rewriters that patched generated SQL strings are gone, with one exception we kept on purpose: a StarRocks `ORDER BY` alias rewrite that runs after generation. About twenty named rewrites still live in BenchBox, but they operate on the fork's parse tree, sit in one registry, and are applied by name. The DDL registry remains only as a record of which rules apply to which platform; the rewriting happens in the fork.

**A declared dialect for every SQL platform.** The platform manifest is the one place that maps a platform to its dialect, and a test pins all 49 SQL platforms to it. The fork added dialects for DataFusion, QuestDB, Netezza, Vertica and Greenplum, which BenchBox previously approximated through PostgreSQL. Athena and SingleStore now generate in their own dialects too; Athena's query text is pinned equal to Trino's, which is what Athena runs.

**Safer defaults.** An unknown platform or dialect is now an error rather than a silent pass-through of the untranslated SQL. A multi-statement query translates every statement, not only the first.

**DDL as a translation target.** `CREATE TABLE` translation covers types, keys, partitioning, clustering and storage layouts per platform: BigQuery `BIGNUMERIC` for decimals wider than `NUMERIC` holds, SingleStore `VECTOR(n, F32)` columns, and Databricks primary keys without the ordering modifiers Databricks rejects.

**The fork is a working repository, not a snapshot.** Between the first bundled runtime and 30.29.0.1 the fork gained SQLite global aggregates without `GROUP BY ()`, SQLite `PIVOT`, `UNPIVOT` and `ORDER BY ALL`, source NULL ordering preserved in positional, window and aggregate order keys (TPC-DS Q49, Q51 and Q74 depend on it), Spark and Databricks regex replacement groups and sub-day `DATE_TRUNC`, SingleStore JSON array indexes, and date-literal padding for QuestDB and DataFusion.

## How we know it is right

Every behavior in the fork is proven by running the translated SQL on a real engine where one is available. The fork's CI runs ten engines: SQLite, DuckDB, DataFusion, ClickHouse (through chDB) and Spark in-process, and PostgreSQL, Trino, QuestDB, StarRocks and Doris as containers pinned by image digest. A translation change that only looks right in a golden file does not pass.

BenchBox adds a second layer. In CI it executes all 22 TPC-H and all 99 TPC-DS queries at scale factor 0.01 on SQLite, DuckDB, DataFusion and PostgreSQL and compares the rows with the reference engine. Every difference has to carry an explanation, and a stale explanation fails the build as surely as a missing one.

Engines with no CI option have translation-corpus evidence instead, and the fork publishes the gap list[^gaps]: the cloud warehouses, Athena (Trino stands in), SingleStore (its development container needs a license), Netezza, Greenplum and Vertica. On those engines we verify the generated text, not its execution.

One lesson cost us a bug. An equality check can pass vacuously. The unpadded date bug survived for as long as it did because at scale factor 0.01 the affected queries return no rows on the reference engine either, and "zero rows equals zero rows" is a pass. Checks now need non-empty evidence or a recorded reason for accepting an empty result.

## What this means for published results

On October 24, 2026 we compared the SQL that BenchBox v0.4.1 generated with the SQL the fork generates for every published result bundle. 124 bundles had run SQL that has since changed. 43 of those had wrong rows or values, or queries that failed and now run. The other 81 differ only in timing or in the SQL text, with the answers unchanged.

All 43 are marked and excluded from rankings until they are rerun. The audit added the marker to 19 of them; the other 24 already carried one for an earlier defect. The results corpus notes record the cause for every affected group.

Where that stands at v0.5.0: 73 of the 124 have been replaced by a rerun, 4 are flagged and not yet replaced, and 47 are note-only. Superseded bundles stay in the corpus, labelled and unranked, so a reader can still see what the old SQL produced. The release post counts the same change from the Explorer's side, across every defect class the release touched: 25 results left the rankings and 58 replacements arrived for ClickHouse Local, DataFusion and SQLite.

In the [Results Explorer](https://benchbox.dev/results/) an excluded result keeps its row but leaves the ranking; the row carries an asterisk, and hovering it shows the exclusion reason.

## What changes for users

Nothing to install or configure. The fork ships inside the `benchbox` wheel as a zip under `benchbox._vendor`, with its MIT license beside it, and the public `sqlglot` package is no longer installed. Every install of a release translates SQL identically, and every result records the translator version, so two people comparing runs are comparing platforms, not translator versions.

Your own SQLGlot is untouched. The bundled copy lives in its own namespace, so both packages install, upgrade and uninstall independently. We test that coexistence in CI, including on Windows.

The cost is small and we measured it. The v0.5.0 wheel is 10.54 MB against 10.63 MB for v0.4.2, so the wheel did not grow, though an install no longer pulls the separate `sqlglot` package. Importing BenchBox no longer loads SQLGlot at all; it loads on the first translation. On one Mac (Python 3.12.15, fresh interpreter, median of 7 runs) `import benchbox` took 363 ms and the first translation, which loads the translator from the zip and then parses and generates one statement, took a further 333 ms.

Rerun your SQLite, DataFusion and ClickHouse workloads after upgrading. Those engines saw value-changing fixes, and the release post lists every engine whose SQL changed.

## Staying current

Upstream tagged 155 commits between v30.24.0 and v30.29.0, so a fork that does not track upstream would fall behind quickly. We merge each upstream release into the fork as one reviewed pull request, after the ten-engine tests pass. BenchBox then adopts the resulting wheel by digest as one reviewed change that links the fork diff, so the review sees exactly what changed in the translator.

A scheduled job in the fork prepares each upstream refresh. Merging it and adopting it stay human decisions.

Security follows the same path. A release check queries the OSV advisory database for the pinned upstream version and blocks the release on a match. An upstream security fix reaches BenchBox users through a fork refresh and a BenchBox release, and our release cadence carries that responsibility.

Each upstream merge is also where generally useful changes get prepared for submission upstream, since that is when the fork and upstream are closest.

## Limitations and commitments

Maintaining a fork is a real, permanent cost, and we chose it with that in view.

Engine coverage has gaps. The cloud warehouses, SingleStore, Netezza, Greenplum and Vertica are verified from translation output, not execution. A translation bug on one of them would show up in a user's run before it showed up in ours.

Most carried patches have not yet been offered upstream. The manifest records the status of each one, and the ledger above is the honest size of the upstreaming so far.

The fork is a translation layer and nothing more. Benchmark definitions, execution, result validation and the published corpus stay in BenchBox.

## What to do next

Upgrade to v0.5.0 and rerun your SQLite, DataFusion and ClickHouse workloads.

Report translation problems with the source dialect, the target dialect and the query. DDL examples are especially welcome.

Follow the fork at [BenchBox-dev/benchbox-sqlglot](https://github.com/BenchBox-dev/benchbox-sqlglot). The patch manifest, the engine gap list and the maintenance guide live under `downstream/`.

---

## References

- Fork repository: [BenchBox-dev/benchbox-sqlglot](https://github.com/BenchBox-dev/benchbox-sqlglot), with `downstream/patches.json`, `downstream/ENGINE-GAPS.md` and `downstream/MAINTAINING.md`. The fork is not published on PyPI; the wheel ships inside `benchbox`.
- Upstream base for the shipped runtime: [SQLGlot v30.29.0](https://github.com/tobymao/sqlglot/releases/tag/v30.29.0); the [v30.24.0 to v30.29.0 delta](https://github.com/tobymao/sqlglot/compare/v30.24.0...v30.29.0).
- Fork refresh for v30.29.0: [benchbox-sqlglot PR #80](https://github.com/BenchBox-dev/benchbox-sqlglot/pull/80); BenchBox adoption: [BenchBox PR #3932](https://github.com/BenchBox-dev/BenchBox/pull/3932).
- Release post: [BenchBox v0.5.0: one SQL translator, execution engines, and tuning that fails loudly](./2026-11-06-v0-5-0-release-overview.md).

[^sqlglot]: [SQLGlot](https://github.com/tobymao/sqlglot) - Python SQL parser and transpiler by Toby Mao and contributors, MIT license.
[^upstream-issues]: [tobymao/sqlglot issue #8347](https://github.com/tobymao/sqlglot/issues/8347) (closed, not planned) and [issue #8348](https://github.com/tobymao/sqlglot/issues/8348) (QuestDB dialect declined). Merged: [PR #8352](https://github.com/tobymao/sqlglot/pull/8352). Carried ahead of release: [PR #8325](https://github.com/tobymao/sqlglot/pull/8325), [PR #8440](https://github.com/tobymao/sqlglot/pull/8440). Overlapping, not carried: [PR #8247](https://github.com/tobymao/sqlglot/pull/8247).
[^manifest]: [`downstream/patches.json`](https://github.com/BenchBox-dev/benchbox-sqlglot/blob/main/downstream/patches.json) at runtime 30.29.0.1, read November 6, 2026.
[^gaps]: [`downstream/ENGINE-GAPS.md`](https://github.com/BenchBox-dev/benchbox-sqlglot/blob/main/downstream/ENGINE-GAPS.md), read November 6, 2026.

*Questions or feedback? [Open an issue](https://github.com/BenchBox-dev/BenchBox/issues) or join the discussion.*
