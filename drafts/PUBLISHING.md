# Blog Publishing Workflow

> How to move a blog post from draft to live on [benchbox.dev/blog](https://benchbox.dev/blog/).

## Overview

Blog drafts and published posts both live in this repository
(`BenchBox-dev/benchbox-site`). Drafts are written under `drafts/`.
Published posts live under `blog/`. There is no second repository and
no replay step. Pull requests run `ci`; merging to `main` triggers
both `ci` and the deploy workflow (`.github/workflows/deploy.yml`).
The post goes live only after a successful production deploy whose
gates all pass.

One article is maintained in exactly one place. A draft lives at
`drafts/{series}/drafts/` until publication; on a named publication
branch it moves into `blog/YYYY-MM-DD-{slug}.md`. Do not retain a
finalized copy under `drafts/`. Research and distinct outlines remain
there; the published article is maintained only in `blog/`.

A publication branch may carry a candidate in `blog/` while it awaits
review. `blog/` on `main` is release-authorized: anything merged there
ships with the next deploy run whose target is set and whose gates pass.

Ownership: Joe owns priority, merge, and release. The author owns
preparation (draft, evidence, editorial checklist). Evidence and
editorial review are manual; no command approves a post.

The site has no Python tooling (see `AGENTS.md`). All validation uses
the Node commands defined in `package.json`. Do not use `uv` or any
Python script to validate blog content; no such script exists in this
repository.

## Directory Structure

### Editorial source (`drafts/`)

Each blog series has a consistent structure:

```
drafts/
  STYLE_GUIDE.md          # Voice and content rules
  VOICE_REFERENCE.md      # Quick reference for tone
  PUBLISHING.md           # This guide
  PUBLICATION_SCHEDULE.md # Publication queue
  ASSETS.md               # What happens to each draft asset
  charts/                 # Chart definitions for scripts/render-blog-charts.mjs
  {series-name}/
    outlines/             # Post outlines and planning
    research/             # Reference materials and notes
    drafts/               # Work-in-progress posts
    images/               # Draft images (mirrored to blog/images/ on publish)
```

Current series include `building-benchbox`, `benchbox-in-action`,
`cloud-cost-controls`, `free-trial-benchmarking`, `platform-deep-dives`
and `table-formats`.

Do not publish from `drafts/**/archived/` or any quarantine path.
Those are explicitly excluded from the publication flow.

### Published site source (`blog/`)

Published posts only:

```
blog/
  index.md                # Blog index (postlist + toctree)
  images/                 # Published images
  2026-01-22-welcome.md   # Published post (YYYY-MM-DD-{slug}.md)
```

`website/` builds the site. At build time it copies `blog/` into the
docs source tree and converts every post with the converter in
`website/src/converter/`. The blog index, archive, tag and author
pages, and the Atom feed are generated from the post frontmatter, so
a correctly placed post with correct frontmatter needs no other
registration beyond the index entry in step 4. Published history comes
from this site archive; there is no standalone series archive, only
inline series navigation inside posts.

## Step-by-Step Publishing Process

### 1. Write the draft

Create the post in `drafts/{series}/drafts/`. Name the file with the
series post number and slug, for example
`drafts/building-benchbox/drafts/18-v0-4-1-release-overview.md`. Follow the
style guide:

- **Voice**: Community-inclusive ("we" not "I"), enthusiastic but grounded
- **Claims**: Back with data, not opinions ("2.3x faster" not "much faster")
- **Platforms**: Neutral, no advocacy. Report the measurement and its
  conditions: platform, query, time, hardware, benchmark, scale and phase.
- **Methodology**: Show your work, acknowledge limitations

See `drafts/STYLE_GUIDE.md` for the full guide and
`drafts/VOICE_REFERENCE.md` for a quick tone reference. Sentence craft
is defined in `VOICE_REFERENCE.md`. Do not copy it here.

New drafts use the same frontmatter the published post will carry.
There is no `title` field (the post title comes from the `#` heading)
and no `status` field (an explicit `status: draft` under `blog/` is
rejected):

```yaml
---
blogpost: true
date: September 29, 2026
author: Joe Harris
series: building-benchbox
post_number: 18
type: release-notes
tags: benchbox, release, lakehouse, delta, iceberg, hudi
meta_description: "One-sentence summary of the post."
---
```

Leave `date` as the intended publication date; set it for real when
the publication branch is cut. Both comma-separated and `[bracketed]`
tag forms parse, so do not rewrite tags that already parse.

**Required fields:**

| Field | Format | Example |
|-------|--------|---------|
| `blogpost` | `true` | `true` |
| `date` | `Month DD, YYYY` | `October 7, 2026` |
| `author` | Author name | `Joe Harris` |
| `tags` | Comma-separated or list | `benchmarking, tpc-h, methodology` |

`series`, `post_number`, `type` and `meta_description` are carried
over when present. The build derives the post title
from the `#` heading and the URL slug from the filename.

Reference draft images relative to the series folder, for example
`../images/{image}.png` from `drafts/{series}/drafts/`.

### 2. Editorial check

Complete the editorial checklist in `drafts/STYLE_GUIDE.md` by hand.
Check in particular:

- No em-dashes (U+2014) or en-dashes (U+2013). Use ASCII hyphens.
- No platform-winner claims or unsourced superlatives.
- Community-inclusive voice, direct imperatives for steps, and no
  LLM writing tells. Ensure that agent work on the writing (reviews,
  style checks and similar) has not added LLM writing tells.

There is no automated blog content validator in this repository.
Editorial quality is a human check against `STYLE_GUIDE.md` and
`VOICE_REFERENCE.md`, backed by the build and repository checks in
step 5. Evidence behind every claim is reviewed by hand in this step.

### 3. Cut a named publication branch and move the post

On a named publication branch, move (not copy) the draft into `blog/`
with its publication filename `YYYY-MM-DD-{slug}.md`, where the date
matches the frontmatter date:

```bash
git mv drafts/{series}/drafts/{post}.md \
  blog/YYYY-MM-DD-{slug}.md
```

The move is not verbatim. On the publication branch, normalize the
moved file before anything else:

- Set the publication `date` for real, matching the filename.
- Add any missing published field (`blogpost: true`, `date`,
  `author`, `tags`). Older drafts may predate this schema.
- Drop draft-only fields: a `title` field (the `#` heading carries
  the title) and any `status: draft` line (rejected under `blog/`).
- Adapt relative links for the destination. Drafts use
  `../images/{image}.png`, while `blog/` uses `./images/{image}.png`.
  Copy each referenced image to `blog/images/` as well.
  Companion-post links in `blog/` must include the companion's
  date-prefixed filename. Do not rely on a blind move when either form
  appears in the source.

In the same pull request, remove the article's upcoming-queue row from
`drafts/PUBLICATION_SCHEDULE.md`, update any series-plan link to the
new `blog/` path, and repair other references to the moved draft.
An unmerged publication pull request leaves the queue on `main`
unchanged; keep it unmerged when the article is approved but held.

For charts, `npm run charts -- <name>` renders a chart from
`drafts/charts/`; add `--publish` to copy the result into
`blog/images/`. Re-render only charts this post changed; leave
unchanged charts alone. See `drafts/ASSETS.md` for how draft assets
are kept in step with their published copies.

### 4. Register the post in the blog index

Edit `blog/index.md`. Add the post filename (without extension) to
the `toctree`, in date order:

````md
```{toctree}
:maxdepth: 1
:hidden:

2026-01-22-welcome
YYYY-MM-DD-{slug}
```
````

The `postlist` directive at the top of the index picks up the new
post for the recent posts listing automatically.

### 5. Validate locally

The full build converts and validates the new post, but it needs the
certified core bundle in `.site-inputs/`. Rebuild after any edit:

```bash
npm run bundle:fetch
npm run build
npm run preview -w website
```

`npm run build` builds the Explorer and the website. The website
build runs the converter over `blog/`, so unresolved links, bad
frontmatter and unknown `toctree` targets fail here. Open the preview
and read the candidate post in place: the branch carrying a candidate
in `blog/` is the previewable state. If the bundle cannot be fetched,
the pull request's CI run uploads a `site-preview` artifact after the
build and website tests pass. Download it and use the same preview
server without rebuilding:

```bash
gh run download <ci-run-id> --name site-preview --dir website/dist
npm run preview -w website
```

Open the candidate post and inspect its images and links before
merge; green `ci` alone is insufficient. State in the pull request
that local building was unavailable and identify the inspected run.

Repository guards also run in CI and as pre-commit hooks via
`lefthook.yml`:

```bash
npm run lint:guard
npm run lint:comments
```

`lint:guard` runs `scripts/check-repo-boundary.mjs`, which fails on
Python files or calls, hard-coded production origins outside the
allowlist, and paths from the old core layout. `lint:comments` runs
`scripts/check-comments.mjs`.

### 6. Open the pull request and hold for release

Commit the moved post, images and index on the named branch, then
open a pull request against `main`:

```bash
git add blog/YYYY-MM-DD-{slug}.md blog/images/{image}.png \
  blog/index.md drafts/PUBLICATION_SCHEDULE.md
git commit -m "docs(blog): publish {title}"
```

Stage files by explicit path only. Never run `git add -A`.
Also stage any updated series plan and other repaired references by
their explicit paths. `git mv` has already staged the old draft's
removal.


The `ci` workflow (`.github/workflows/ci.yml`) fetches and verifies
the core bundle, then runs the script tests, `lint:comments`,
`lint:guard`, `bundle:verify`, the Explorer and website type checks,
the unit tests and `npm run build`. All of it must pass.

An approved pull request may stay unmerged until its release window.
Merging authorizes the existing workflow; it is not proof the post is
live. After merge, the deploy workflow
(`.github/workflows/deploy.yml`) builds and, when the repository's
deploy target is set, deploys the site. Nothing deploys unless every
deploy gate passes.

### 7. Confirm the post is live

Confirm each of these; none follows from the merge alone:

- the deploy target is `production`, not unset or `rehearsal`,
- the production deploy workflow completed successfully,
- the deployed receipt identifies the expected site commit,
- the live URL `https://benchbox.dev/blog/YYYY-MM-DD-{slug}.html`.

Read the deployed receipt with:

```bash
npm run deploy -- deployed
```

The post will automatically be included in:

- The blog index and recent posts listing
- Archive pages (organized by year)
- Tag and author pages (based on frontmatter)
- The Atom feed (`blog/atom.xml`)

Check the post live at `https://benchbox.dev/blog/` after the deploy
run succeeds.

## Quick Checklist

- [ ] Draft written in `drafts/{series}/drafts/`
- [ ] Style guide followed (`drafts/STYLE_GUIDE.md`)
- [ ] STYLE_GUIDE editorial checklist completed by hand
- [ ] Evidence behind each claim reviewed by hand
- [ ] No em-dashes or en-dashes; voice checked against `VOICE_REFERENCE.md`
- [ ] Published frontmatter normalized on the branch (`blogpost`, `date`, `author`, `tags` present; no `title` or `status` field even if the draft had them); `#` heading carries the title; publication `date` set for real and matching the filename
- [ ] Filename follows convention: `YYYY-MM-DD-{slug}.md`
- [ ] Post moved (not copied) into `blog/` on a named publication branch; no `published/` archive copy created
- [ ] `blog/` copy uses `./images/` links; referenced images copied to `blog/images/`
- [ ] Changed charts re-rendered with `npm run charts -- <name> --publish`; unchanged charts left alone
- [ ] Companion links use exact date-prefixed filenames in `blog/`
- [ ] Post added to `blog/index.md` toctree
- [ ] Upcoming-queue row removed and links to the moved draft repaired in the same pull request
- [ ] Candidate rendered and inspected using a fresh local build or the identified CI `site-preview` artifact
- [ ] Pull request `ci` checks pass against `main`
- [ ] Pull request merged to `main` by Joe; deploy run succeeded
- [ ] Production target, deploy receipt, and live URL confirmed at `https://benchbox.dev/blog/YYYY-MM-DD-{slug}.html`
