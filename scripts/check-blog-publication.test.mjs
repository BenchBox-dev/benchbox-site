import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkPublication, isoFromPostDate, linkFindings, planFindings, postFindings, toctreeEntries } from "./check-blog-publication.mjs";

const NOW = Date.parse("2026-10-20");

function post(overrides = {}) {
  const front = { blogpost: "true", date: "October 7, 2026", author: "Joe Harris", tags: "benchbox, release", ...overrides };
  const lines = Object.entries(front).filter(([, value]) => value !== null).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n\n# Title\n`;
}

function index(...stems) {
  return `# Blog\n\n\`\`\`{toctree}\n:maxdepth: 1\n:hidden:\n\n${stems.join("\n")}\n\`\`\`\n`;
}

test("post dates accept full and abbreviated month names and reject anything else", () => {
  assert.equal(isoFromPostDate("October 7, 2026"), "2026-10-07");
  assert.equal(isoFromPostDate("Jan 22, 2026"), "2026-01-22");
  assert.equal(isoFromPostDate("2026-10-07"), null);
  assert.equal(isoFromPostDate("Octember 7, 2026"), null);
});

test("a post whose date disagrees with its file name is refused", () => {
  const posts = [{ name: "2026-10-08-late.md", source: post() }];
  assert.deepEqual(postFindings(posts, index("2026-10-08-late")), ["blog/2026-10-08-late.md: date October 7, 2026 does not match the file name date"]);
});

test("required front matter fields and the file name shape are enforced", () => {
  const posts = [
    { name: "2026-10-07-ok.md", source: post() },
    { name: "2026-10-07-no-author.md", source: post({ author: null }) },
    { name: "2026-10-07-no-tags.md", source: post({ tags: "[]" }) },
    { name: "2026-10-07-not-a-post.md", source: post({ blogpost: "false" }) },
    { name: "notes.md", source: post() },
  ];
  const findings = postFindings(posts, index("2026-10-07-ok", "2026-10-07-no-author", "2026-10-07-no-tags", "2026-10-07-not-a-post"));
  assert.deepEqual(findings, [
    "blog/2026-10-07-no-author.md: front matter needs author",
    "blog/2026-10-07-no-tags.md: front matter needs tags",
    "blog/2026-10-07-not-a-post.md: front matter needs blogpost: true",
    "blog/notes.md: file name must be YYYY-MM-DD-slug.md",
  ]);
});

test("toctree entries and posts must match in both directions", () => {
  const posts = [{ name: "2026-10-07-a.md", source: post() }, { name: "2026-10-07-b.md", source: post() }];
  assert.deepEqual(toctreeEntries(index("x", "y")), ["x", "y"]);
  assert.deepEqual(postFindings(posts, index("2026-10-07-a", "2026-10-07-ghost", "2026-10-07-a")), [
    "blog/index.md: toctree lists 2026-10-07-ghost but blog/2026-10-07-ghost.md does not exist",
    "blog/index.md: toctree lists 2026-10-07-a twice",
    "blog/index.md: toctree is missing 2026-10-07-b",
  ]);
});

test("links that do not resolve are reported with file and line", () => {
  const source = "[ok](a/drafts/ok.md#frag)\n[gone](a/drafts/gone.md)\n[web](https://example.com/x.md)\n[anchor](#top)\n";
  assert.deepEqual(linkFindings("drafts/PUBLICATION_SCHEDULE.md", source, (file) => file === "drafts/a/drafts/ok.md"), [
    "drafts/PUBLICATION_SCHEDULE.md:2: link a/drafts/gone.md does not resolve",
  ]);
});

test("a series plan that states prices needs the time-sensitive note", () => {
  assert.equal(planFindings("drafts/s/outlines/series-plan.md", "Costs $5 per run\n").length, 1);
  assert.deepEqual(planFindings("drafts/s/outlines/series-plan.md", "> **Time-sensitive figures:** x\nCosts $5\n"), []);
  assert.deepEqual(planFindings("drafts/s/outlines/series-plan.md", "No prices here\n"), []);
});

function fixture(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), "benchbox-blog-"));
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), source);
  }
  return root;
}

const HEADER = "| Article | Source | Priority | Owner | Next action | Facts verified | Blockers / notes |\n| --- | --- | --- | --- | --- | --- | --- |\n";

function schedule(...rows) {
  return `# Schedule\n\n## Upcoming queue\n\n${HEADER}${rows.join("\n")}\n\n---\n\n## Backlog\n`;
}

function row(name, verified, notes = "-") {
  return `| ${name} | [Draft](s/drafts/${name}.md) | High | Joe | Review | ${verified} | ${notes} |`;
}

test("queue and drafts must agree, and withheld rows need a hold field", () => {
  const root = fixture({
    "blog/index.md": index(),
    "drafts/PUBLICATION_SCHEDULE.md": schedule(row("queued", "-"), row("held", "-", "Publication withheld"), row("missing", "-")),
    "drafts/s/drafts/queued.md": "---\nblogpost: true\n---\n# Q\n",
    "drafts/s/drafts/held.md": "# H\n",
    "drafts/s/drafts/orphan.md": "---\nhold: later\n---\n# O\n",
  });
  try {
    const { findings } = checkPublication(root, NOW);
    assert.deepEqual(findings.sort(), [
      "drafts/PUBLICATION_SCHEDULE.md:9: link s/drafts/missing.md does not resolve",
      "drafts/s/drafts/orphan.md: draft has no row in the Upcoming queue",
      'queue row "held": marked withheld but drafts/s/drafts/held.md has no hold field',
      'queue row "missing": drafts/s/drafts/missing.md does not exist',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a hold field without a withheld row is refused", () => {
  const root = fixture({
    "blog/index.md": index(),
    "drafts/PUBLICATION_SCHEDULE.md": schedule(row("quiet", "-")),
    "drafts/s/drafts/quiet.md": '---\nhold: "later"\n---\n# Q\n',
  });
  try {
    assert.deepEqual(checkPublication(root, NOW).findings, ["drafts/s/drafts/quiet.md: has a hold field but its queue row is not marked withheld"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("time-sensitive rows need a verification mark and warn when stale or never verified", () => {
  const notes = "Time-sensitive: terms change";
  const root = fixture({
    "blog/index.md": index(),
    "drafts/PUBLICATION_SCHEDULE.md": schedule(row("bare", "-", notes), row("fresh", "2026-10-10", notes), row("old", "2026-08-01", notes), row("never", "never", notes), row("junk", "soon", notes)),
    ...Object.fromEntries(["bare", "fresh", "old", "never", "junk"].map((name) => [`drafts/s/drafts/${name}.md`, "# X\n"])),
  });
  try {
    const { findings, warnings } = checkPublication(root, NOW);
    assert.deepEqual(findings.sort(), [
      'queue row "bare": time-sensitive rows need a Facts verified date or never',
      'queue row "junk": Facts verified must be -, never or YYYY-MM-DD',
    ]);
    assert.deepEqual(warnings, [
      'queue row "old": facts last verified 2026-08-01; re-verify before publishing',
      "1 time-sensitive queue rows have never had their facts verified",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a consistent tree passes", () => {
  const root = fixture({
    "blog/index.md": index("2026-10-07-a"),
    "blog/2026-10-07-a.md": post(),
    "drafts/PUBLICATION_SCHEDULE.md": schedule(row("queued", "-")),
    "drafts/s/drafts/queued.md": "# Q\n",
    "drafts/s/outlines/series-plan.md": "[queued](../drafts/queued.md)\n",
  });
  try {
    assert.deepEqual(checkPublication(root, NOW), { findings: [], warnings: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
