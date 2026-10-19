# "BenchBox in Action" Content Plan

**Concept**: Hands-on benchmark explorations demonstrating BenchBox's MCP + CLI workflow
**Audience**: Data engineers, analytics practitioners, AI tool users exploring database benchmarking
**Tone**: Exploratory, evidence-based, educational (per Blog Style Guide v2.0)
**Length**: 2,000-3,000 words
**Cadence**: Monthly (tied to significant methodology findings)

## Series vision

This series demonstrates **real benchmarking workflows** using BenchBox: MCP server for exploration and initiation, CLI for execution, and MCP tools for result comparison and investigation. Each post walks through an actual benchmark session, from question to execution to methodology insight.

**Key differentiator**: We're not publishing benchmark shootouts. We're showing how BenchBox's multi-platform, multi-mode support surfaces interesting findings about benchmarking methodology, query optimization, and execution path differences.

**Important**: This is NOT a platform comparison series. The focus is on demonstrating BenchBox's capabilities and sharing methodology insights. Platform results are presented as illustration, not as recommendations. This blog does not publish platform-vs-platform opinions or vendor advocacy.

## Post template

### Structure

1. **The question** (~200 words)
   - What we wanted to investigate
   - Why it matters for benchmarking methodology

2. **MCP exploration** (~300 words)
   - Discovering platforms and benchmarks
   - Previewing the run (dry_run)
   - Forming the test plan

3. **CLI execution** (~300 words)
   - Exact commands used
   - Representative output
   - What was held constant vs. varied

4. **MCP analysis** (~600 words)
   - Comparing results (compare_results)
   - Identifying patterns and outliers
   - Investigating specific queries (get_query_details)

5. **Methodology insight** (~500 words)
   - What this reveals about benchmarking
   - Implications for interpreting results
   - How BenchBox's tooling surfaced the finding

6. **Test environment** (~200 words)
   - Hardware, software versions, configuration
   - Raw result file paths
   - Limitations

### Metadata template

Frontmatter follows `drafts/PUBLISHING.md`: no `title` field (the `#` heading carries the title) and no `status` field. Set the publication `date` for real on the publication branch.

```yaml
blogpost: true
date: Month DD, YYYY
author: Joe Harris
series: benchbox-in-action
post_number: N
type: technical-challenge
tags: benchmarking, benchbox, mcp, {topic}, {platform}
meta_description: "One-sentence summary of the post."
```

## Posts

Location is the one maintained copy: published posts link their `blog/` canonical file, unpublished posts their draft or outline file. Publication order is set in `drafts/PUBLICATION_SCHEDULE.md`, not here.

| # | Title | Location | Methodology insight |
|---|-------|----------|---------------------|
| 1 | BenchBox in action: discovering the SQL vs DataFrame optimization gap | No draft file in `drafts/`; research notes in the Post #1 section below | Same engine, different interfaces → 9.4x gap reveals decorrelation architecture |
| 2 | BenchBox in action: vector search across six engines (and what recall@k does to your numbers) | [Outline](02-vector-search-recall-latency.md) | Reporting ANN latency without recall@k compares apples to oranges across engines |
| 3 | BenchBox in action: scale factor effects on query rankings | Idea, no file yet | Query rankings change at different scale factors |
| 4 | BenchBox in action: cloud vs embedded cost-per-query | Idea, no file yet | What does a TPC-H query actually cost on Snowflake vs local DuckDB? |
| 5 | BenchBox in action: tuned vs untuned benchmarking | Idea, no file yet | How much does platform-specific tuning change results? |
| 6 | BenchBox in action: DataFrame translation challenges | Idea, no file yet | Where do DataFrame implementations diverge from SQL semantics? |
| 7 | BenchBox in action: when the same query needs different code | [Draft](../drafts/06-platform-specific-optimization-patterns.md) ([outline](06-platform-specific-optimization-patterns.md)) | Same DataFrame pattern, 5x difference across platforms → query planner architecture |


## Key themes

### 1. The BenchBox workflow (MCP + CLI)

Every post demonstrates the same workflow pattern:
- **MCP** to explore (list_platforms, get_benchmark_info, dry_run)
- **CLI** to execute (benchbox run with specific flags)
- **MCP** to analyze (compare_results, get_query_details, get_results)
- **Investigation** when something interesting surfaces

### 2. Methodology transparency

Every post includes:
- Exact commands used
- Platform versions
- Hardware/configuration
- Link to raw JSON results
- Known limitations

### 3. Insights over shootouts

Focus on findings that inform benchmarking methodology:
- When do aggregate metrics hide important per-query differences?
- How does the interface (SQL/DataFrame) affect measured performance?
- What does scale factor selection actually change about results?
- Where do execution path differences matter vs. not?

### 4. Neutral presentation

Present platform results as data, not recommendations:
- "DataFusion SQL completed Q21 in 110ms; DataFrame mode took 1,038ms"
- NOT "DataFusion SQL is better" or "Use SQL mode for complex queries"
- Let readers draw their own conclusions from the methodology insights

## Series tone examples

**Good** (methodology-focused):
> "We expected DataFusion's DataFrame API to match its SQL performance, after all, they both compile to the same LogicalPlan. BenchBox's compare_results tool showed that 21 of 22 queries performed equivalently, but Q21 differed by 9.4x."

**Good** (workflow-focused):
> "The MCP server flagged Q21 as an 843% regression. That single data point led to an investigation into subquery decorrelation, a finding that aggregate metrics alone would have obscured."

**Bad** (platform advocacy):
> "Polars wins 16 of 22 queries. DataFusion needs to fix their DataFrame implementation."

**Bad** (vague):
> "Both platforms have their strengths and weaknesses. It really depends on your use case."

## Post #1: Discovering the SQL vs DataFrame optimization gap

### The question
Does the interface (SQL vs DataFrame) affect benchmark results when using the same engine?

### Key findings
1. **21 of 22 queries perform equivalently** across SQL and DataFrame modes
2. **Q21 shows a 9.4x gap**,SQL's decorrelation step produces a fundamentally different plan
3. **Aggregate metrics mask the difference**,geometric means are nearly identical (60.7ms vs 58.7ms)
4. **The gap is architectural, not accidental**,SQL gets a pre-optimization step that DataFrame bypasses

### Narrative arc
1. MCP exploration: discover `datafusion` and `datafusion-df` as separate platforms
2. CLI execution: run TPC-H SF1 against both modes
3. MCP comparison: identify Q21 as a massive outlier
4. Investigation: understand the decorrelation architecture
5. Methodology insight: interface affects measured performance; per-query analysis is essential

### Research completed
- [x] Ran DataFusion SQL TPC-H SF1
- [x] Ran DataFusion DataFrame TPC-H SF1
- [x] Identified Q21 anomaly via compare_results
- [x] Researched DataFusion decorrelation architecture
- [x] Read BenchBox Q21 DataFrame implementation
- [x] Found Ibis benchmark confirmation
- [x] Drafted post (2,600 words)

---

## Integration with BenchBox

This series serves multiple purposes:

1. **Workflow demonstration**: Shows MCP + CLI capabilities in practice
2. **Methodology content**: Teaches benchmarking concepts through real examples
3. **Community value**: Reproducible investigations invite verification and discussion
4. **SEO content**: Targets "DataFusion benchmark", "SQL vs DataFrame performance" searches

---

*Series created: 2026-01-18*
*Last updated: 2026-10-19 (locations replace the status matrix; queue lives in `drafts/PUBLICATION_SCHEDULE.md`)*
*Revised: Removed platform-vs-platform framing; aligned with Blog Style Guide v2.0*
