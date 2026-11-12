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
  core first, then the site adds support for it, then core may drop the
  older schema. The verifier accepts exact schemas 4 and 5, each with
  its own exact member set; schema 3 is retired. Both schemas carry
  `docs-data/docs-data.json` and `doc-contracts.json`, validated against
  the schemas vendored in `scripts/schemas/`. Schema 4 still carries `docs`
  and `downloads`, which the site no longer reads; schema 5 drops them.
  Unknown schemas, member sets and extra entries in `docs-data` fail.
- `certified_by` is the numeric id of the core `trunk.yml` push run on
  `develop` for the bundle commit. Online certification requires that run
  id for schemas 4 and 5, with the same attestations. The value
  `candidate` is valid for schemas 4 and 5 under `--offline` verification
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
- The site publishes no `objects.inv` Sphinx inventory. Nothing consumed it,
  and the deploy probe no longer requires it.
- The sidebar is the tree in `docs/nav.yml`: groups with a `label` and
  `items`, where an item is a page path, `{page, label, items}` for a page
  with a label override or children, or `{label, url}` for an external link.
  A group with `generated: tag-categories` lists the tag categories. Convert
  fails with the line in `nav.yml` for an unknown key, an empty group, a page
  that does not exist or a page listed twice under one parent. A page that is
  not listed still builds; add it to `docs/nav.yml` to put it in the sidebar.
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
- Core keeps maintainer-only material (`docs/agent/`, `docs/internal/`,
  `design/future-state/`, the threat model, the workaround index, the TPC
  licensing analysis and the publication lists). The site publishes
  nothing from those paths: listing sources fails when the tree holds any
  of them, in place of a publish list.
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
  fetched bundle for pushes to `next` and pull requests into `next`.
- `ci` checks the pin with `npm run docs:pin -- --check`: the pin must be
  well formed and its tag a published release.
- Unreleased documentation merges to `next`, where CI checks it against the
  newest develop bundle. Fixes to released documentation merge to `main`;
  whoever merges one then merges `main` into `next` with a merge commit.
- A release is: the owner runs `npm run docs:pin -- vX.Y.Z` on `next` by pull
  request, then opens one pull request from `next` into `main`. After that
  squash merge, merge `main` into `next` to bring it level.
- The Nightly workflow opens or updates the `docs-release-pending` issue when
  core has published a release newer than the pin. The owner acts on it.
- Compatibility window: site code on `main` must read the pinned release's
  `docs-data` and `doc-contracts.json`. Code on `next` must read both the pin
  and the newest develop bundle until the next release is pinned.
- Never edit pinned members by hand; `npm run docs:pin` writes them.
- `docs:pin` fetches and verifies the certified bundle of the tag's commit, so
  a tag whose commit has no such bundle cannot be pinned. Bundles expire after
  90 days, so pin soon after a release. `--from <dir>` pins a bundle directory
  that was verified elsewhere and skips the fetch and its certification check;
  use it only for a release whose bundle the current verifier cannot read.

## Deploys

- `.github/workflows/deploy.yml` runs on a push to `main`, on a
  `core-bundle` dispatch from core, and by hand with `mode` set to
  `deploy`, `redeploy` (this site commit with the core bundle that is live, fetched
  by the deployed receipt's `core_sha` and checked against its `bundle_digest`;
  it fails when no receipt is deployed) or `rollback` (restore the
  artifact of the receipt run named in `receipt_run_id`).
- A `deploy` run whose resolved core bundle is behind the deployed one does
  not fail. If the deployed receipt's `site_sha` is this run's commit, the
  run is superseded: it logs a notice, skips the build and the `deploy` job
  and reports nothing. Otherwise it deploys this site commit with the
  deployed core bundle, fetched by `core_sha` and checked against the
  receipt's `bundle_digest`. A diverged bundle, an unknown status or a failed
  compare still fails; divergence is class `diverged-bundle`.
- The repository variable `SITE_DEPLOY_TARGET` decides what a run does.
  Unset, it resolves, builds and gates, then stops. `rehearsal` deploys to
  `SITE_ORIGIN` with every page marked `noindex`. `production` deploys
  benchbox.dev. Only the owner decides to set `production`.
- Nothing deploys unless every gate passes: privacy, Explorer
  compatibility, snapshot digest, links (within
  `inventory/known-broken-links.json`) and origin. The privacy gate also
  rejects a `*.plans.json` plans companion in the artifact that carries a
  local filesystem path; `deploy/README.md` lists the rule and what it does
  not cover.
- The snapshot digest gate fails when the corpus is unchanged but the
  snapshot contents differ from the deployed ones, for example after a core
  pipeline change. After reviewing the change, the owner sets the repository
  variable `SITE_SNAPSHOT_APPROVED_CHANGE` to the exact
  `<deployed digest>-><candidate digest>` value that the failed gate prints,
  and `SITE_SNAPSHOT_APPROVAL_REASON` to the reason, then reruns the deploy.
  The approval matches only that pair. Clear both variables after the deploy.
- Each deploy writes a receipt, uploads it with the artifact, and records
  its digest on the GitHub Pages deployment. `npm run deploy -- deployed`
  prints the current one. If the probes fail after a deploy, the run
  dispatches at most one rollback to the last known good receipt.
- A rollback does not stay in place by itself: the next deploy run that
  passes the gates replaces it. To hold one, the owner rolls back while
  `SITE_DEPLOY_TARGET` still matches the receipt's target, waits for that run
  to finish, then clears the variable; the steps and resume are in
  `deploy/README.md` under "Holding a rollback".
- The post-deploy probe compares served bytes with the artifact and repeats
  every ten seconds for at most eleven minutes of monotonic elapsed time,
  which covers the ten-minute `max-age` of the served pages while Pages and
  its CDN still answer with the previous generation. The final probe runs at
  the deadline, and a mismatch still present then fails the run.
- A failed run opens or updates a site-local `site-deploy-failed` issue.
  Core-dispatched failures also relay to core under `site-bundle-undeployed`,
  classified as producer-not-concluded, contract-version-mismatch,
  snapshot-digest, probe-mismatch or infrastructure (including unknown errors).
  Contract mismatches require updating the Explorer for the new contract.
  The relay comments only when the latest reported class changes; a successful
  deploy comments and closes only issues bearing that relay label.
- Set the boolean `expected_rejection` manual input, or the
  `client_payload.expected_rejection` dispatch field to `true`, for deliberate
  negative probes such as wrong digests or runs before certification.
  The explicit marker suppresses both local and core incident writes,
  including success closure. Error text cannot set it. Unmarked failures
  always report. This matches the core bundle reporter's `expected_rejection`
  input; it does not bypass any deploy gate.
- `npm run test:deploy` includes an isolated real-process `gh` stub smoke
  covering class transitions, unchanged creation bodies, closure and markers.
- Bundle fetch waits at most ten minutes of monotonic elapsed time for the
  producer to complete successfully, including API calls; an unfinished success
  conclusion does not bypass completion. Each poll request uses the remaining
  deadline as its fetch timeout.
- Bundle and receipt downloads share three attempts, with delays of 5 and
  15 seconds. Only HTTP 5xx and network failures retry. Each attempt starts
  with an empty temporary download directory; digest, provenance and deploy
  gates remain outside the retry boundary. Retry delays add at most 20 seconds.
- A failed run opens or updates an issue.
- `.github/workflows/nightly-browser.yml` runs the Explorer `@smoke` suite on
  Firefox and WebKit daily and on dispatch. A failure opens or updates the one
  open issue labelled `t3:browser`.
- The Visual comparison workflow screenshots a PR's build and the deployed
  artifact and reports the differences. It is advisory: it is not part of
  `ci` and never fails on a difference.
- The Nightly workflow's `links` job checks external links in `blog/`, `docs/`
  and the site pages, including their `#fragment` anchors, with `.lychee.toml`,
  which carries the scoped ignore policy for flaky and login-gated hosts and
  the fragment allowlist for anchors that JavaScript builds. It then checks the published
  documentation: every `/docs/` page in the `SITE_ORIGIN` sitemap, with
  fragments, for links to that origin (the scoped policy's own-origin exclusion
  yields to the check's include pattern). `scripts/check-published-links.mjs` accepts the
  failures whose target is in `inventory/known-broken-links.json` and fails on
  any other. Either failure opens or updates the `broken-links` issue.

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
  of `/results/`, which belongs to the Explorer's client routes. A withdrawn
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
  `next` (unreleased documentation), as described under "Release pin". `main`
  accepts squash merges only and requires the `ci` check.
- Stage files by explicit path. Never run `git add -A` or `git add .`.
- Commit identity: `Joe Harris <joeharris76@gmail.com>`. Add no agent or
  co-author trailers.
- Commit messages, pull request text and committed files state the durable
  reason for a change. Leave out tracker ids, plan or handoff references and
  run-local state such as CI counts.
- Merge with `gh pr merge --squash` once `ci` is green. Auto-merge is turned
  off for this repository.

## Tracker

- Work for this repository is tracked on its own `todo-state` branch.
  `.tractable/config.json` binds the `tractable` MCP server that `.mcp.json`
  starts to that branch. The server runs on the developer's machine as
  `tractable-mcp` and is not part of the site build.
- Use tractable 1.0.0 or later. Before the first tracker write in a session,
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
