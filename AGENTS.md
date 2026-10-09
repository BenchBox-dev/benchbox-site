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
- The bundle schema is an integer major version. The site supports schema N
  and N-1. A schema change lands in core first, then the site adds support
  for it, then core may drop N-1.
- Never read core files by any other route. A guard test fails the build on
  any path outside the repository other than `$SITE_INPUTS`.

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
- Each deploy writes a receipt, uploads it with the artifact, and records
  its digest on the GitHub Pages deployment. `npm run deploy -- deployed`
  prints the current one. If the probes fail after a deploy, the run
  dispatches at most one rollback to the last known good receipt.
- A failed run opens or updates an issue.
- `npm run shadow:compare -- <core tree> website/dist
  inventory/shadow-allowlist.json` compares a build with core's build of
  the same bundle. Every allowed difference in that file carries a reason.
- The Visual comparison workflow screenshots a PR's build and the deployed
  artifact and reports the differences. It is advisory: it is not part of
  `ci` and never fails on a difference.

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
