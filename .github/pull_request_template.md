## What changed and why

## Base branch

- [ ] I checked the base branch. `main` is for site code, workflows and corrections to released documentation. `next` is for documentation or blog posts about behaviour that is not in the pinned release (see "Release pin" in `AGENTS.md`).
- [ ] If this merges to `main`, `main` is then merged into `next`.
- [ ] Release pull request into `main` only: I reviewed each documentation change on `next` since the previous pin against the release tag's source, restored the released text of every passage that is not true at the release, and corrected passages that are false at the release on both branches.
- [ ] Release pull request only: corrections that are also true on `develop` are applied to `next` before `main` is merged into `next`, and the held-back text is still on `next` afterwards.
