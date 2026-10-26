# benchbox-site agent instructions

This repository builds and deploys benchbox.dev: the Astro site in
`website/`, the Results Explorer in `explorer/`, the landing assets in
`landing/`, the published blog in `blog/` and blog drafts in `drafts/`.
Benchmark code, results data and the docs sources live in the core
repository, `BenchBox-dev/BenchBox`. The site builds from the repository
itself plus one versioned core bundle; it reads nothing else from core.

## Language

- No Python in this repository: no `.py` file, `pyproject.toml` or
  `uv.lock` in the tree or in history, and no `python`, `python3`, `uv` or
  `uvx` call apart from the one below.
- Tooling is Node and TypeScript. A third-party tool fetched at run time is
  allowed, for example a pinned `npx` package. The one Python tool the site
  runs is the published `benchbox` CLI, as an external program pinned to the
  bundle's version, from `scripts/render-blog-charts.mjs` only.

## The core bundle

- `npm run bundle:fetch` downloads the newest certified core bundle into
  `.site-inputs/` (git-ignored) and verifies its digest, schema and
  certification before anything reads it.
- The bundle schema is an integer major version. A schema change lands in
  core first, then the site adds support for it, then core may drop the
  older schema. The verifier accepts exact schemas 3, 4 and 5, each with
  its own exact member set. Schemas 4 and 5 add
  `docs-data/docs-data.json` and `doc-contracts.json`, validated against
  the schemas vendored in `scripts/schemas/`. Schema 5 drops `docs` and
  `downloads`. Unknown schemas, member sets and extra entries in
  `docs-data` fail.
- `certified_by` is the numeric id of the core `trunk.yml` push run on
  `develop` for the bundle commit. Online certification requires that run
  id for schemas 3 and 4 alike, with the same attestations. The value
  `candidate` is valid for schemas 4 and 5 under `--offline` verification
  only, and never passes online certification. Schema 5 accepts only
  `candidate`, so it cannot be deployed yet.
- `npm run docs:check` (`docs-contracts/`, TypeScript) checks the bundle's
  documentation against the `doc-contracts.json` facts core exports: registry
  and platform counts, the benchmark API surface, the quickstart commands,
  `--platform-option` examples, the MCP reference, SF1 sizes, sketch bounds,
  version markers, the Python API headings and the publication boundary. The
  contract-internal consistency checks always block. The page checks block
  with `--docs-mode block` (the default) and only print with
  `--docs-mode report`; CI and the deploy build pass `report` until the
  documentation moves into this repository, and that move changes them to
  block. A schema 3 bundle has no `doc-contracts.json`: `--allow-schema3`
  skips the contract checks and runs only the negative publication guard,
  without the flag the run fails, and a schema 4 or 5 bundle without the
  member always fails. `--docs <dir>` checks a documentation tree other than
  the bundle's `docs` member. `npm run test:docs-contracts` runs the seeded
  drift tests; `DOC_CONTRACTS_SCHEMA4_BUNDLE=<bundle dir>` adds a run
  against a real schema 4 bundle.
- Never read core files by any other route. A guard test fails the build on
  any path outside the repository other than `$SITE_INPUTS`.
- `npm run docs:parity -w website` runs the TypeScript generators on the
  bundle's `docs-data` and compares the output byte for byte with the
  bundle's `docs` member. The generated scope is `benchmarks/queries/`,
  `compat/` and `reference/tuning-platform-support.md`. Every changed,
  missing and extra path in that scope fails the run and is named with its
  first differing byte and SHA-256 digests; nothing is normalized. A bundle
  without `docs-data` (schema 3) reports not applicable unless
  `--require-applicable` is given. `--report <file>` writes the full
  difference list with path and SHA-256 inventories of both sides. `ci` runs
  it; production rendering still reads the bundled Markdown.

## Deploys

- `.github/workflows/deploy.yml` runs on a push to `main`, on a
  `core-bundle` dispatch from core, and by hand with `mode` set to
  `deploy`, `redeploy` (the same bundle again) or `rollback` (restore the
  artifact of the receipt run named in `receipt_run_id`).
- The repository variable `SITE_DEPLOY_TARGET` decides what a run does.
  Unset, it resolves, builds and gates, then stops. `rehearsal` deploys to
  `SITE_ORIGIN` with every page marked `noindex`. `production` deploys
  benchbox.dev. Only the owner decides to set `production`.
- Nothing deploys unless every gate passes: privacy, Explorer
  compatibility, snapshot digest, links (within
  `inventory/known-broken-links.json`) and origin.
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
- `npm run shadow:compare -- <core tree> website/dist
  inventory/shadow-allowlist.json` compares a build with core's build of
  the same bundle. Every allowed difference in that file carries a reason.
- The Visual comparison workflow screenshots a PR's build and the deployed
  artifact and reports the differences. It is advisory: it is not part of
  `ci` and never fails on a difference.

## Core and this repository

Core's data and pipeline changes reach this repository through the core
bundle and need no action here: core's `site-inputs.yml` builds the
`site-inputs-<sha>` artifact after each successful push to `develop` and
dispatches `core-bundle`, and the deploy fetches and verifies it.

The site, the Explorer, the landing assets, the blog and the drafts live
only here. Change them in this repository by pull request.

Adaptations to keep:

- Explorer code takes the origin from `SITE_ORIGIN` in
  `explorer/src/components/siteOrigin.ts` and never hard-codes the
  production origin. `npm run lint:guard` fails on a hard-coded one.

## Changes

- Work on a named branch and open a pull request to `main`. `main` accepts
  squash merges only and requires the `ci` check.
- Stage files by explicit path. Never run `git add -A` or `git add .`.
- Commit identity: `Joe Harris <joeharris76@gmail.com>`. Add no agent or
  co-author trailers.
- Commit messages, pull request text and committed files state the durable
  reason for a change. Leave out tracker ids, plan or handoff references and
  run-local state such as CI counts.
- Merge with `gh pr merge --squash` once `ci` is green. Auto-merge is turned
  off for this repository.

## Code comments

First-party code carries no explanatory comments or docstrings. Name things
so the code explains itself. Directives the tools need (license headers,
`eslint-disable`, `@ts-expect-error`, triple-slash references) are allowed.
`npm run lint:comments` enforces this, and `ci` runs it.
