# benchbox-site agent instructions

This repository builds and deploys benchbox.dev: the Astro site in
`website/`, the Results Explorer in `explorer/`, the landing assets in
`landing/`, the published blog in `blog/` and blog drafts in `drafts/`.
Benchmark code and results data live in the core
repository, `BenchBox-dev/BenchBox`. The documentation under `docs/` is
authored here. Apart from the documentation inputs
described under "Release pin", the site builds from the repository itself plus one
versioned core bundle; it reads nothing else from core.

## Language

- No Python in this repository: no `.py` file, `pyproject.toml` or
  `uv.lock` in the tree or in history, and no `python`, `python3`, `uv` or
  `uvx` call apart from the one below.
- Tooling is Node and TypeScript. A third-party tool fetched at run time is
  allowed, for example a pinned `npx` package. The one Python tool the site
  runs is the published `benchbox` CLI, as an external program pinned to the
  release pin's version, from `scripts/render-blog-charts.mjs` only.

## The core bundle

- `npm run bundle:fetch` downloads the newest certified core bundle, newest
  by core commit order among the recent successful site-inputs runs, into
  `.site-inputs/` (git-ignored) and verifies its digest, schema and
  certification before anything reads it.
- The bundle schema is an integer major version. A schema change lands in
  core first, then the site adds support, then core may drop the older
  schema. `scripts/bundle-verify.mjs` and `scripts/schemas/` define the
  accepted schemas. The verifier accepts exact schemas 4, 5 and 6, each with
  its exact member set. Schema 6 is schema 5 plus the top-level member
  `result-bundle.schema.json`: a JSON Schema draft 2020-12 document whose
  `$id` is `https://benchbox.dev/schemas/result-bundle-2.schema.json` and
  whose top-level `result_schema_version` is a `2.x` string. The verifier
  checks that it parses, compiles and carries those markers; it does not
  compare its bytes with core's copy.
- When the bundle has `result-bundle.schema.json`, the build publishes it at
  `/schemas/result-bundle-2.schema.json` (the URL carries the result
  bundle's major version) from `website/src/lib/result-schema.ts`, and the
  deploy probe checksums it. The privacy gate scans it like every other JSON
  file in the artifact, and `deploy/origin-allowlist.json` lets its production
  `$id` pass the rehearsal origin gate.
- `certified_by` is the numeric id of the core `trunk.yml` push run on
  `develop` for the bundle commit. Online certification requires that run
  id for schemas 4, 5 and 6, with the same attestations. The value
  `candidate` is valid for schemas 4, 5 and 6 under `--offline` verification
  only, and never passes online certification.
- `npm run docs:check` (`docs-contracts/`, TypeScript) checks the site's
  documentation against the `doc-contracts.json` facts of the docs inputs (the release pin, or the newest bundle when `DOCS_INPUTS` names it): registry
  and platform counts, the benchmark API surface, the quickstart commands,
  `--platform-option` examples, the MCP reference, SF1 sizes, sketch bounds,
  version markers, the Python API headings and the publication boundary. It
  assembles the documentation the way the build does (the authored pages in
  `docs/`, the generated pages and the versioned landing page) and checks that
  tree; `--docs <dir>` checks another documentation tree instead. The
  contract-internal consistency checks always block. The page checks block
  with `--docs-mode block` (the default) and only print with
  `--docs-mode report`; `ci` and the deploy build pass `block` (rollback
  restores an artifact and runs no check), so page drift fails the run
  before the build and before publication. Docs inputs without
  `doc-contracts.json` always fail. `npm run test:docs-contracts` runs the
  seeded drift tests; `DOC_CONTRACTS_SCHEMA4_BUNDLE=<bundle dir>` adds a run
  against a real bundle.
- `inventory/core-linked-paths.json` lists every core path that a relative
  link in `docs/` or `blog/` points at, with its kind and the
  `file:line` of each link. It is generated through the converter's own link
  resolution: `npm run inventory:core-links -w website` rewrites it and
  `-- --check` fails when it is stale; `ci` runs the check. Core reads the
  file from `main` to refuse a pull request that deletes or moves a listed
  path. To rename or delete such a path: drop the link or pin it to a core SHA
  here and merge, merge the core change, then relink here.
- Never read core files by any other route. A guard test fails the build on
  any path outside the repository other than `$SITE_INPUTS`.

## Documentation

- `docs/` holds the published pages, authored here, with their original
  MIT license text in `docs/LICENSE`. The build assembles them with the
  pages that `npm run docs:generate -w website` renders from the docs inputs'
  `docs-data` (the generated scope: `benchmarks/queries/`, `compat/` and
  `reference/tuning-platform-support.md`) and with `blog/`. An authored page
  in the generated scope or under `docs/blog/` fails the assembly.
- Pages are plain GitHub-flavoured Markdown. They render the same on GitHub
  as on the site. The converter does not read MyST, and a guard
  (`website/src/converter/myst-guard.ts`) fails the build with the file and
  line on the constructs that would otherwise render as stray text: a
  directive fence (```` ```{name} ````), a role before an inline code span
  a `(label)=` line and a `myst` front matter key. Write the plain form instead: GitHub alerts, `.md`
  links, `<span id>` anchors and bold lead-ins in place of definition lists.
- The sidebar is the tree in `docs/nav.yml`: groups with a `label` and
  `items`, where an item is a page path, `{page, label, items}` for a page
  with a label override or children, or `{label, url}` for an external link.
  A group with `generated: tag-categories` lists the tag categories. Convert
  fails with the line in `nav.yml` for an unknown key, an empty group, a page
  that does not exist or a page listed twice under one parent. A page that is
  not listed still builds; add it to `docs/nav.yml` to put it in the sidebar.
- The build publishes `/llms.txt` and a Markdown copy of every page under
  `docs/` at `/docs/<page>.md`, next to `/docs/<page>.html`. The converter
  writes both to `website/.generated/` (`markdown/`, `manifest/llms.txt`)
  from the same converted pages, and `scripts/publish-markdown.ts` copies them
  into `dist` after the dev-docs mount. `llms.txt` is generated, never edited:
  the fixed sections in `website/src/lib/llms.ts` (`FEATURED_SECTIONS`: install
  and first run, CLI, MCP, methodology, result summaries) come first, then the
  `docs/nav.yml` groups, then an Optional section for every page that
  `docs/nav.yml` does not list. Only generated-scope pages that a listed index
  links to (the per-query and compatibility pages) are left out of the file,
  and tag pages are never listed. A featured page that does not exist fails the
  conversion. `npm run check:llms -w website` and the build fail when a link
  in `llms.txt` or in a Markdown page points at a file that is not in `dist`.
  The blog, result summaries, search and the Explorer have no Markdown copy.
  The deploy probe compares `/llms.txt` and sampled `.md` files with the
  artifact and requires a `text/plain` or `text/markdown` content type.
- Tags are the `tags` list in front matter, which must be the first thing in
  the file. The tag pages under `/docs/_tags/` are generated from them.
- Cross-references are relative `.md` links, for example
  `[Title](../usage/installation.md#section)`. The converter checks that the
  page and the fragment exist. Heading ids follow the docutils algorithm, and
  `<span id="old-anchor"></span>` lines keep published fragments working.
- Admonitions are GitHub alerts (`> [!NOTE]`, `TIP`, `IMPORTANT`,
  `WARNING`, `CAUTION`), diagrams are `mermaid` code fences, and tables are
  pipe tables.
- Results Explorer results are embedded with a `benchbox-result` code fence
  (`kind: cited` or `kind: current`); the converter turns it into an island
  that loads the Explorer only when it scrolls into view. Print a cited block
  with `npm run results:cite -w website -- <result id>`. The syntax is in
  `docs/design/results-embeds.md`.
- The blog index is rendered by the blog template from the published posts;
  `blog/index.md` holds only the introduction.
- `docs/README.md` is the landing page. Its `{{package_version}}` token
  becomes the `package_version` of the docs inputs' manifest, so the release
  marker in the page always matches the release the docs describe.
- Never copy core maintainer-only material (`docs/agent/`, `docs/internal/`,
  `design/future-state/`, the threat model, the workaround index, the TPC
  licensing analysis, the publication lists) here; listing sources fails if
  any appears. A new page under `docs/development/` or `docs/operations/` also
  needs an entry in core's `docs/publish-allowlist.txt`.
- Edit links point at this repository. Generated pages (`benchmarks/queries/`,
  `compat/`, `reference/tuning-platform-support.md`) and renderer pages carry
  none.
- `npm run lint:docs` runs markdown lint and spelling over `docs/`. Fix
  findings; add a genuine word to `cspell-words.txt` instead of exempting a
  page. `ci` runs it.

## Release pin

- `release-pin/` holds the docs inputs of one published core release. Docs
  assembly, `docs:check`, `docs:generate`, core-file link pinning and the blog
  chart renderer read it.
- The Explorer, the result summaries, the prompt catalog and the deploy gates
  still read the newest certified bundle.
- `DOCS_INPUTS` names the directory the docs inputs are read from. Unset or
  empty means `release-pin/`. `ci` and the Visual workflow set it to the
  fetched bundle for pushes to `next` and pull requests into `next`. There
  `ci` also assembles the docs against the pin, so site code
  that stops reading the pinned release fails before the release pull
  request. The Visual workflow builds pull requests into `next` from the
  deployed bundle, not the newest one; that is accepted because it is
  advisory.
- `ci` checks the pin with `npm run docs:pin -- --check`: the pin must be
  well formed and its tag a published release.
- Unreleased documentation merges to `next`, where CI checks it against the
  newest develop bundle. Fixes to released documentation merge to `main`;
  the Sync next workflow then opens or updates the `next-behind-main` issue
  while `next` lacks commits that are on `main`, and closes it once `next`
  contains them. Site code, workflows and corrections to released
  documentation go to `main`; only documentation of unreleased behaviour goes to
  `next`. After a merge to `main`, merge `main` into `next` by pull request
  with `gh pr merge --merge`. The issue says whether that merge is clean or
  names the conflicting files, which a person resolves by hand in that pull
  request; where released text from `main` conflicts with unreleased text on
  `next`, `next` keeps its text.
- A merge of `main` into `next` can also remove unreleased text without a
  conflict: when `main` drops a passage that is not true at the release and
  `next` has not changed that passage, git applies the removal to `next`. The
  `next-behind-main` issue lists each `docs` or `blog` file the merge would
  delete lines from, computed by `scripts/next-deletions.mjs` from a merge that
  writes no ref. A conflicting file is listed too when the merge deletes lines
  from it outside the conflict markers. A listed deletion is either a correction
  from `main` or such a removal. In the merge pull request, restore `next`'s
  text for each passage whose removal does not also apply on `develop`, and
  state in its description that the listed files were checked.
- A blog post about unreleased BenchBox behaviour waits on `next` and reaches
  `main` with the release. Nothing mechanical can tell what a post describes,
  so the author declares it with the front matter key `requires_release:
  X.Y.Z`, the first release that contains what the post describes.
  `npm run lint:blog` checks the value is well formed and, only when
  `DOCS_INPUTS` is unset or empty, fails a post whose `requires_release` is
  above `release-pin/manifest.json`'s `package_version`. When `DOCS_INPUTS`
  is set, as on `next`, the release gate is skipped: the develop bundle's
  version is the last release, not the upcoming one. A post that links a core path added after
  the pinned release must link by commit SHA or carry `requires_release`.
- A release is automated up to two pull requests that the owner merges; no
  workflow merges, pushes to `main` or `next`, or force-pushes. The Release
  docs workflow (hourly, on dispatch and on the `core-release` repository
  dispatch) runs `docs:pin -- --pending` against `next`'s pin. For a newer
  release it creates the branch `release-pin/<tag>` from `next`, runs
  `npm run docs:pin -- <tag>`, and opens a pull request into `next`; the
  owner squash-merges it. A tag that already has a pull request in any state
  is skipped, and a branch without one gets a pull request opened. A pin that fails, for example because no certified bundle
  exists, creates no branch and comments the error on the open
  `docs-release-pending` issue. The same workflow, on each push to `next`,
  opens `Release documentation for <tag>` from `next` into `main` when
  `next`'s pin tag is above `main`'s and no pull request into `main` has that
  title in any state or names the tag while open. Its body lists the files whose
  content differs between `main` and `next` and the documentation commits on
  `next` since the previous pin; releases squash into `main`, so a plain
  `main..next` log would list every commit ever made on `next`. It uses the
  `SITE_BRIDGE_APP_ID` GitHub App, whose pushes and pull requests start `ci`
  where the default token's would not; the app needs contents and pull-requests
  write on this repository.
- Hold back what is not true at the release before merging the release pull
  request. `next` documents core `develop`, which runs ahead of the release.
  `docs:check` against the new pin fails `ci` only on the facts core exports in
  `doc-contracts.json`; every other passage on `next` that is not true at the
  release passes `ci`, so review each documentation change on `next` since the
  previous pin against the release tag's source. Automation never edits those
  passages. The owner branches from `next`, restores the released text for each
  such passage, and corrects passages that are false at the release on both
  branches. The owner then closes the release pull request, opens one from that
  branch into `main` with the same title and squash-merges it once `ci` is
  green. Last, `main` is merged into `next` by pull request with
  `gh pr merge --merge`. Before that merge, apply to `next` the corrections
  that are also true on `develop`; in the conflicts, `next` keeps its text, so
  a correction applied only on `main` would be lost there. Confirm the
  held-back text is still on `next`. A pull request's head branch cannot
  change, hence the replacement; the workflow opens no further release pull
  request while one exists in any state.
- The Nightly workflow opens or updates the `docs-release-pending` issue when
  core has published a release newer than the pin. It remains the backstop when the Release docs workflow cannot
  open the pin pull request, and the owner then acts on it by hand with
  `npm run docs:pin -- <tag>`.
- Compatibility window: site code on `main` must read the pinned release's
  `docs-data` and `doc-contracts.json`. Code on `next` must read both the pin
  and the newest develop bundle until the next release is pinned.
- Never edit pinned members by hand; `npm run docs:pin` writes them.
- `docs:pin` fetches and verifies the certified bundle of the tag's commit, so
  a tag whose commit has no such bundle cannot be pinned. Bundles expire after
  90 days; when one is missing, dispatch core's `site-inputs.yml` with
  `core_sha` set to the tag to rebuild it. A commit can then have more than one
  unexpired bundle. Their docs inputs are identical, but `manifest.json`
  differs (`produced_at`, `parent_source`, member digests), so `docs:pin` takes
  the earliest one by creation time, then by run id, and re-pinning writes the
  same files. It records that site-inputs run as `site_inputs_run` in
  `release-pin/pin.json`. `--from <dir>` pins a complete bundle
  directory, for a release whose bundle the current verifier cannot read. It
  checks the manifest fields and core commit, the digest of every member the
  manifest lists, `attestations.json`, and online that `certified_by` is a core
  trunk.yml push run on develop that succeeded for that commit; it fails closed
  on an API error and refuses `candidate`. It skips only the member schema
  validation.

## Deploys

- Deploy reference is in `deploy/README.md`: trigger modes, superseded and
  diverged-bundle runs, post-deploy probe timing, download retries, failure
  reports, the Nightly and Visual workflows and link-check internals.
  Deliberate negative probes set `expected_rejection`; see it there.
- The repository variable `SITE_DEPLOY_TARGET` decides what a run does.
  Unset, it resolves, builds and gates, then stops. `rehearsal` deploys to
  `SITE_ORIGIN` with every page marked `noindex`. `production` deploys
  benchbox.dev. Only the owner decides to set `production`.
- Nothing deploys unless every gate passes: privacy, Explorer compatibility,
  snapshot digest, links (within `inventory/known-broken-links.json`) and
  origin (`deploy/README.md`).
- Only the owner approves a snapshot-digest change
  (`SITE_SNAPSHOT_APPROVED_CHANGE`, `SITE_SNAPSHOT_APPROVAL_REASON`;
  `deploy/README.md` "Snapshot digest"). Never set these variables yourself.
- A rollback is replaced by the next passing deploy; to hold one, the owner
  follows `deploy/README.md` "Holding a rollback".
- A rollback reaches back 14 days, the retention of `site-artifact-<run>`.
  `deploy/README.md` "Artifact retention" lists every reader of the deploy
  artifacts and their retention.

## Core and this repository

Core's data and pipeline changes reach this repository through the core
bundle and need no action here, apart from pinning each release as described
under "Release pin": core's `site-inputs.yml` builds the
`site-inputs-<sha>` artifact after each successful push to `develop` and
dispatches `core-bundle`, and the deploy fetches and verifies it.

The site, the Explorer, the landing assets, the blog and the drafts live
only here. Change them in this repository by pull request.

Adaptations to keep:

- Explorer code takes the origin from `SITE_ORIGIN` in
  `explorer/src/components/siteOrigin.ts` and never hard-codes the
  production origin. `npm run lint:guard` fails on a hard-coded one.
- Result summary pages under `/result-summaries/` are generated at site build
  time from the bundle's `explorer/results.duckdb`, through the Explorer's own
  queries and formatters (`website/src/lib/results-summary.ts`). Keep them out
  of `/results/`, which belongs to the Explorer's client routes, with one exception:
  `/results/r/<public_result_id>` is a static page per published result, generated
  by `website/src/pages/results/r/[id].html.ts` from the Explorer's own `index.html`,
  which the Explorer replaces in the browser. A withdrawn
  result disappears from the pages and the search index on the next build
  because it is gone from the snapshot. See
  `docs/design/adr-results-summary-pages.md`.
- The site serves no copies of core files. Documentation links to files
  outside `docs/` point at GitHub, pinned to the docs inputs' `core_sha`. The
  Sphinx-era URLs `/docs/_downloads/<md5>/<name>`, and the `TPC_EULA.txt`
  sidecars beside TPC query templates, are a closed set recorded in
  `inventory/legacy-downloads.json`. Each is published, also under
  `/docs/dev/`, as a redirect page at `<name>/index.html`, so the dotted legacy
  URL normalizes to a directory that answers as `text/html`. Targets stay
  pinned to the inventory's archive commit, not to later bundles, and a
  template's redirect page links the adjacent TPC license. Redirect pages stay
  out of the sitemap and the search index.
  `npm run verify:legacy-downloads -w website` drives them in Chromium
  against a built `website/dist`.

## Changes

- Work on a named branch and open a pull request to `main` (fixes to released
  documentation and everything that is not unreleased documentation) or to
  `next` (unreleased documentation and blog posts), as described under "Release pin". `main`
  accepts squash merges only and requires the `ci` check.
- Stage files by explicit path. Never run `git add -A` or `git add .`.
- Commit identity: `Joe Harris <joeharris76@gmail.com>`. Add no agent or
  co-author trailers.
- Commit messages, pull request text and committed files state the durable
  reason for a change. Leave out tracker ids, plan or handoff references and
  run-local state such as CI counts.
- Merge with `gh pr merge --squash` once `ci` is green: pull requests into
  `main` are squash-merged, and so are pull requests into `next`, except the
  one that merges `main` into `next`. Merge that one with
  `gh pr merge --merge` so main's commits stay in next's history. Auto-merge
  is turned off for this repository.

## Tracker

- Work for this repository is tracked on its own `todo-state` branch.
  `.tractable/config.json` binds the `tractable` MCP server that `.mcp.json`
  starts to that branch. The server runs on the developer's machine as
  `tractable-mcp` and is not part of the site build.
- Use tractable 1.1.1 or later: the store holds registered batches, which
  older clients refuse. Before the first tracker write in a session,
  confirm the bound store by passing `BenchBox-dev/benchbox-site` as
  `expect_store`. A server bound to core's tracker refuses it.
- Work that needs changes in both repositories is tracked in core, with
  links to the site paths it touches.
- Change tracker state only through the server, never by editing the branch.

## Code comments

First-party code carries no explanatory comments or docstrings. Name things
so the code explains itself. Directives the tools need (license headers,
`eslint-disable`, `@ts-expect-error`, triple-slash references) are allowed.
`npm run lint:comments` enforces this, and `ci` runs it.
