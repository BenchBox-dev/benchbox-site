# Blog Publishing Workflow

> How to move a blog post from draft to live on [benchbox.dev/blog](https://benchbox.dev/blog/).

## Overview

Blog drafts and published posts both live in this repository
(`BenchBox-dev/benchbox-site`). Drafts are written under `drafts/`.
Published posts live under `blog/`. There is no second repository and
no replay step: merging a pull request to `main` in this repository
builds and deploys the site, and the post goes live with that deploy.

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
    published/            # Finalized posts (series archive)
    images/               # Draft images (mirrored to blog/images/ on publish)
```

Current series include `building-benchbox`, `benchbox-in-action`,
`cloud-cost-controls`, `free-trial-benchmarking`, `platform-deep-dives`
and `table-formats`.

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
registration beyond the index entry in step 6.

## Step-by-Step Publishing Process

### 1. Write the draft

Create the post in `drafts/{series}/drafts/`. Name the file with the
series post number and slug, for example
`drafts/building-benchbox/drafts/19-site-redesign.md`. Follow the
style guide:

- **Voice**: Community-inclusive ("we" not "I"), enthusiastic but grounded
- **Claims**: Back with data, not opinions ("2.3x faster" not "much faster")
- **Platforms**: Neutral, no advocacy. Report the measurement and its
  conditions: platform, query, time, hardware, benchmark, scale and phase.
- **Methodology**: Show your work, acknowledge limitations

See `drafts/STYLE_GUIDE.md` for the full guide and
`drafts/VOICE_REFERENCE.md` for a quick tone reference. Sentence craft
is defined in `VOICE_REFERENCE.md`. Do not copy it here.

Draft frontmatter carries a `title` and `status: draft`:

```yaml
---
title: "Post Title"
blogpost: true
status: draft
date: October 7, 2026
author: Joe Harris
series: building-benchbox
post_number: 19
type: architecture-design
tags: [benchbox, design, website]
meta_description: "One-sentence summary of the post."
---
```

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
step 7.

### 3. Finalize the post

Once the editorial checklist is complete and the post is reviewed:

1. Copy the draft to `drafts/{series}/published/` for archival.
2. Prepare the publication filename: `YYYY-MM-DD-{slug}.md`, where
   the date is the publication date in the frontmatter.

### 4. Prepare the published frontmatter

The published copy drops the draft-only `title` (the post title comes
from the `#` heading) and the YAML tag list becomes a comma-separated
string. Set `status` to `published`:

```yaml
---
blogpost: true
status: published
date: October 7, 2026
author: Joe Harris
series: building-benchbox
post_number: 19
type: architecture-design
tags: benchbox, design, website
meta_description: "One-sentence summary of the post."
---

# Post Title

Post content...
```

**Required fields:**

| Field | Format | Example |
|-------|--------|---------|
| `blogpost` | `true` | `true` |
| `date` | `Month DD, YYYY` | `October 7, 2026` |
| `author` | Author name | `Joe Harris` |
| `tags` | Comma-separated | `benchmarking, tpc-h, methodology` |

`series`, `post_number`, `type` and `meta_description` are carried
over from the draft when present. The build derives the post title
from the `#` heading and the URL slug from the filename.

### 5. Place the post in the published tree

Copy the finalized post to `blog/` in this repository:

```bash
cp drafts/{series}/published/{post}.md \
   blog/YYYY-MM-DD-{slug}.md
```

Then adapt relative links for the destination.
`drafts/{series}/published/` uses `../images/{image}.png`, while
`blog/` uses `./images/{image}.png`. Copy each referenced image to
`blog/images/` as well. Companion-post links in `blog/` must include
the companion's date-prefixed filename. Do not rely on a blind copy
when either form appears in the source.

For charts, `npm run charts -- <name>` renders a chart from
`drafts/charts/`; add `--publish` to copy the result into
`blog/images/`. See `drafts/ASSETS.md` for how draft assets are kept
in step with their published copies.

### 6. Register the post in the blog index

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

### 7. Validate locally

Run the repository checks that do not need the core bundle first:

```bash
npm run lint:guard
npm run lint:comments
```

`lint:guard` runs `scripts/check-repo-boundary.mjs`, which fails on
Python files or calls, hard-coded production origins outside the
allowlist, and paths from the old core layout. `lint:comments` runs
`scripts/check-comments.mjs`. Both run in CI and as pre-commit hooks
via `lefthook.yml`.

The full build also converts and validates the new post, but it
needs the certified core bundle in `.site-inputs/`:

```bash
npm run bundle:fetch
npm run build
```

`npm run build` builds the Explorer and the website. The website
build runs the converter over `blog/`, so unresolved links, bad
frontmatter and unknown `toctree` targets fail here. If the bundle
cannot be fetched, rely on the pull request checks in step 8 and
say so in the pull request.

### 8. Open the pull request

Commit the archive copy, published copy, images and index on a named
branch, then open a pull request against `main`:

```bash
git add drafts/{series}/published/{post}.md \
  blog/YYYY-MM-DD-{slug}.md blog/images/{image}.png \
  blog/index.md
git commit -m "docs(blog): publish {title}"
```

Stage files by explicit path only. Never run `git add -A`.

The `ci` workflow (`.github/workflows/ci.yml`) fetches and verifies
the core bundle, then runs the script tests, `lint:comments`,
`lint:guard`, `bundle:verify`, the Explorer and website type checks,
the unit tests and `npm run build`. All of it must pass.

### 9. Merge the post

Merge the pull request to `main` with a squash merge once `ci` is
green. The deploy workflow (`.github/workflows/deploy.yml`) then
builds and, when the repository's deploy target is set, deploys the
site. Nothing deploys unless every deploy gate passes.

The post will appear at `https://benchbox.dev/blog/YYYY-MM-DD-{slug}/`
and will automatically be included in:

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
- [ ] No em-dashes or en-dashes; voice checked against `VOICE_REFERENCE.md`
- [ ] Final post archived in `drafts/{series}/published/`
- [ ] Published frontmatter set (`blogpost`, `status: published`, `date`, `author`, `tags`)
- [ ] Filename follows convention: `YYYY-MM-DD-{slug}.md`
- [ ] `drafts/` archive keeps `../images/` links; `blog/` copy uses `./images/`
- [ ] Referenced images copied to `blog/images/`
- [ ] Companion links use exact date-prefixed filenames in `blog/`
- [ ] Post copied to `blog/` in this repository
- [ ] Post added to `blog/index.md` toctree
- [ ] `npm run lint:guard` and `npm run lint:comments` pass
- [ ] Pull request `ci` checks pass against `main`
- [ ] Pull request merged to `main`; deploy run succeeded
- [ ] Post checked live at `https://benchbox.dev/blog/`
