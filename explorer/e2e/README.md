# Explorer browser-functional tests

Playwright suite that exercises the built explorer (`dist/`) against the
fixture corpus that the core bundle carries. Architecture decisions live in
core, in `docs/internal/browser-test-architecture.md` of `BenchBox-dev/BenchBox`.

## One-shot local run

```bash
npm ci
npm run bundle:fetch
cd explorer
npm run test:e2e:install
npm run test:e2e:chromium
npm run test:e2e:full
```

`test:e2e:install` runs once and downloads the browser binaries. `test:e2e:chromium` stages the bundle's fixtures, rebuilds `dist/` and runs Chromium. `test:e2e:full` is the local full-matrix convenience entrypoint.

For a brand-new machine, `npm run test:e2e:chromium:setup` wraps the browser
install and then runs the same deterministic Chromium entrypoint.

The browser scripts restage `test-fixtures/.generated/` from `.site-inputs/`, rebuild `dist/`,
and then invoke Playwright, which starts the static server in
`scripts/serve-browser-tests.mjs`. The server mounts `dist/` at `/results/`
and routes `/results/data/` to `test-fixtures/.generated/data/`.

## Nightly Firefox and WebKit run

`.github/workflows/nightly-browser.yml` runs the `@smoke` tests on Firefox and
WebKit every day and on `workflow_dispatch`. Each browser is its own matrix
leg: it fetches the newest certified bundle, installs that browser and runs
`npm run test:e2e:<browser> -w explorer`. Pull request CI runs Chromium only.
A failed leg uploads `playwright-report-<browser>` and opens or updates the one
open issue labelled `t3:browser`, adding a comment per failing run.

## Project layout

- `smoke/` - shell-level sanity checks tagged `@smoke`; also run under
  Firefox and WebKit projects.
- `routes/` - per-route happy-path coverage (w4-w6).
- `failures/` - injected-failure coverage against user-visible error
  states (w7).
- `capability/` - server/runtime contract checks that are not user
  failure paths (e.g. the RG-2 range-read gate).
- `support/` - helpers for fixture-routing, clipboard, and download flows.

## Writing a new test

- Tag anything that must run on all three browsers with `@smoke`; new
  tests are Chromium-only by default.
- Prefer user-visible assertions (rendered copy, visible error banner)
  over internal state or console noise.
- Never mutate `explorer/public/data/` or the bundle in `.site-inputs/`;
  use the fixture staging script or Playwright route interception instead.

## See also

- `docs/internal/results-explorer-qa.md` in `BenchBox-dev/BenchBox` — the
  manual end-to-end QA test plan that pairs with this automated suite.
