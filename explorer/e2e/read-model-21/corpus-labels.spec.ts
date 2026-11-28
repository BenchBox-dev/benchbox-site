import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { waitForDataElement, waitForShell } from "../support/fixtures";

const INPUTS = process.env.SITE_INPUTS ?? resolve(process.cwd(), "..", ".site-inputs");
const ASSIGNMENTS_FILE = resolve(INPUTS, "read-model-assignments.json");

interface Assignments {
  readModelVersion: number;
  fixtures: Record<string, string>;
  fixturePlatforms: Record<string, string>;
  fixtureUnlabelled: string;
}

const assignments: Assignments | null = existsSync(ASSIGNMENTS_FILE)
  ? (JSON.parse(readFileSync(ASSIGNMENTS_FILE, "utf8")) as Assignments)
  : null;

const DERIVED = "Derived from TPC-H. These results do not comply with the TPC-H Specification and must not be compared with official TPC-H results.";
const CLASS_POWER_ONLY = "Power test only";
const ROW_COUNTS = "Row counts not checked";
const ITERATION = "Single iteration";
const DERIVED_DS = "Derived from TPC-DS. These results do not comply with the TPC-DS Specification and must not be compared with official TPC-DS results.";
const CLASS_PARTIAL = "Partial run: not every required phase ran";

const ALL_TEXTS = [DERIVED, CLASS_POWER_ONLY, ROW_COUNTS, ITERATION, DERIVED_DS, CLASS_PARTIAL];

function resultFor(example: string): string {
  const id = Object.entries(assignments?.fixtures ?? {}).find(([, exampleId]) => exampleId === example)?.[0];
  if (!id) throw new Error(`no fixture result carries ${example}`);
  return id;
}

const RANKED_RELEASE = () => resultFor("example-ranked-release");
const PRE_RELEASE = () => resultFor("example-pre-release");
const PARTIAL = () => resultFor("example-version-not-recorded");

const EXPECTED: Record<string, readonly string[]> = {
  "example-ranked-release": [DERIVED, CLASS_POWER_ONLY],
  "example-pre-release": [DERIVED, CLASS_POWER_ONLY, ROW_COUNTS, ITERATION],
  "example-version-not-recorded": [DERIVED_DS, CLASS_PARTIAL, ROW_COUNTS],
};

async function expectExactly(scope: Locator, expected: readonly string[]) {
  for (const text of expected) {
    await expect(scope.getByText(text, { exact: true }), `label "${text}"`).toBeVisible();
  }
  for (const text of ALL_TEXTS.filter((candidate) => !expected.includes(candidate))) {
    await expect(scope.getByText(text, { exact: true }), `label "${text}" must be absent`).toHaveCount(0);
  }
}

async function expectSurface(page: Page, testId: (resultId: string) => string) {
  for (const [example, expected] of Object.entries(EXPECTED)) {
    const scope = page.getByTestId(testId(resultFor(example)));
    await waitForDataElement(page, scope);
    await expectExactly(scope, expected);
  }
}

test.describe("read-model 21 corpus labels", () => {
  test.skip(assignments === null || assignments.readModelVersion !== 21, "needs the read-model 21 inputs from scripts/stage-read-model-inputs.mjs");

  test("leaderboard rows carry the labels of each run and no other run carries any", async ({ page }) => {
    await page.goto("/results/tpch/");
    await waitForShell(page);
    await expectSurface(page, (id) => `benchmark-list-corpus-labels-${id}`);
    await expect(page.locator('ul[data-testid^="benchmark-list-corpus-labels-"]')).toHaveCount(3);
  });

  test("the result detail page shows the labels in its summary and in its receipt", async ({ page }) => {
    for (const [example, expected] of Object.entries(EXPECTED)) {
      await page.goto(`/results/r/${resultFor(example)}`);
      await waitForShell(page);
      const summary = page.getByTestId("detail-corpus-labels");
      await waitForDataElement(page, summary);
      await expectExactly(summary, expected);
      const receipt = page.getByTestId("receipt-corpus-labels");
      await expect(receipt).toBeVisible();
      await expectExactly(receipt, expected);
    }
  });

  test("a result without labels shows no label block on its detail page", async ({ page }) => {
    await page.goto(`/results/r/${assignments!.fixtureUnlabelled}`);
    await waitForShell(page);
    await waitForDataElement(page, page.getByRole("heading", { name: /Query timings/ }));
    await expect(page.getByTestId("detail-corpus-labels")).toHaveCount(0);
    await expect(page.getByTestId("receipt-corpus-labels")).toHaveCount(0);
  });

  test("the comparison lists the labels of every compared run", async ({ page }) => {
    await page.goto(`/results/compare?ids=${[RANKED_RELEASE(), PRE_RELEASE(), PARTIAL()].map(encodeURIComponent).join(",")}`);
    await waitForShell(page);
    await expectSurface(page, (id) => `compare-corpus-labels-${id}`);
  });

  test("the meta-leaderboard shows the labels in the cell of each labelled run", async ({ page }) => {
    await page.goto("/results/compare/");
    await waitForShell(page);
    await expectSurface(page, (id) => `meta-corpus-labels-${id}`);
  });

  test("the platform page shows the labels beside each labelled run", async ({ page }) => {
    for (const [example, expected] of Object.entries(EXPECTED)) {
      const resultId = resultFor(example);
      await page.goto(`/results/p/${assignments!.fixturePlatforms[resultId]}/`);
      await waitForShell(page);
      const scope = page.getByTestId(`platform-corpus-labels-${resultId}`);
      await waitForDataElement(page, scope);
      await expectExactly(scope, expected);
    }
  });
});
