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
- A failed run opens or updates an issue.
- `npm run shadow:compare -- <core tree> website/dist
  inventory/shadow-allowlist.json` compares a build with core's build of
  the same bundle. Every allowed difference in that file carries a reason.
- The Visual comparison workflow screenshots a PR's build and the deployed
  artifact and reports the differences. It is advisory: it is not part of
  `ci` and never fails on a difference.

## Replaying core changes

Core's data and pipeline changes reach this repository through the core
bundle and need no action here: core's `site-inputs.yml` builds the
`site-inputs-<sha>` artifact after each successful push to `develop` and
dispatches `core-bundle`, and the deploy fetches and verifies it.

Core also holds the source of six paths that this repository keeps a copy
of. A change to one of them in core does not deploy. It reaches benchbox.dev
only when it is replayed here by pull request.

| Core path | Path here |
| --- | --- |
| `results-explorer/` | `explorer/` |
| `docs/blog/` | `blog/` |
| `_blog/` | `drafts/` |
| `_project/design/site-inventory/` | `inventory/` |
| `website/` | `website/` |
| `landing/` | `landing/` |

`SEED_RENAMES` in `scripts/replay-fidelity.mjs` is the authority for this
table. To replay:

1. Find the last replayed core SHA in the title of the newest replay commit:
   `git log -1 --grep='^Replay'`.
2. Choose the core commit to replay through (`<ref>`) and list the commits
   that touch the mapped paths since the last one:
   `git -C <core> log --format='%h %s' <last>..<ref> -- results-explorer docs/blog _blog _project/design/site-inventory website landing`.
3. For each touched file, copy core's version to the mapped path here:
   `git -C <core> show <ref>:<core path> > <site path>`. Delete the copy of
   any file core deleted. Where this repository keeps a deliberate
   adaptation, merge three ways instead: write core's version at `<last>`
   and at `<ref>` to temporary files and run
   `git merge-file <site path> <core at last> <core at ref>`.
4. List every file that stays different from core in
   `inventory/replay-allowlist.json` with its `site` path and a `reason`.
5. Run `node scripts/replay-fidelity.mjs --core <core> --ref <ref> --since <last>`.
   It reads git objects only, so any core clone that has both commits works.
   It must report 0 blocking. A file reported as `mismatch`, `missing` or
   `core-removed` blocks. `identical`, `allowlisted` and `removed` (deleted
   in both core and here) do not.
6. Run `npm run bundle:fetch`, then the commands of the `checks` job in
   `.github/workflows/ci.yml`. The `e2e` and `audit` jobs run in CI.
7. Open a pull request to `main` titled
   `Replay <what changed> from core through <ref>`, and squash-merge it once
   `ci` is green. The push to `main` deploys.

Adaptations to keep when replaying:

- Explorer code takes the origin from `SITE_ORIGIN` in
  `explorer/src/components/siteOrigin.ts` and never hard-codes the
  production origin. `npm run lint:guard` fails on a hard-coded one.
- Core fixtures can bring words that `cspell-words.txt` lacks. The pre-commit
  hook runs cspell, so add them there.

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
