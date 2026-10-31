import { expect, test, type Page } from "@playwright/test";
import { waitForShell } from "../support/fixtures";
import {
  HEADER_CTA,
  HEADER_DESKTOP_MIN_HEIGHT_PX,
  HEADER_HEIGHT_TOLERANCE_PX,
  HEADER_MOBILE_MIN_HEIGHT_PX,
  HEADER_NAV_ARIA_LABEL,
  HEADER_TOGGLE_ARIA_LABEL,
  getHeaderVisibleLabels,
} from "../../src/components/headerContract";

const GLOBAL_LABELS = getHeaderVisibleLabels();

async function chooseTheme(page: Page, choice: "system" | "light" | "dark") {
  const button = page.locator("[data-theme-toggle]");
  for (let step = 0; step < 3; step++) {
    if ((await button.getAttribute("data-theme-choice")) === choice) break;
    await button.click();
  }
  await expect(page.locator("html")).toHaveAttribute("data-bb-theme-choice", choice);
}

test.describe("Global header", () => {
  test("@smoke preserves the global header contract on desktop", async ({ page }) => {
    await page.goto("/results/");
    await waitForShell(page);

    const globalNav = page.getByRole("navigation", { name: HEADER_NAV_ARIA_LABEL });
    await expect(globalNav.getByRole("link")).toHaveText(GLOBAL_LABELS);
    await expect(globalNav.getByRole("link", { name: "Results" })).toHaveAttribute("aria-current", "page");
    await expect(globalNav.getByRole("link", { name: HEADER_CTA.label })).toHaveAttribute("href", HEADER_CTA.href);
    await expect(globalNav.getByRole("button", { name: /Color theme/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Color theme: / })).toBeVisible();

    const explorerNav = page.getByRole("navigation", { name: "Results Explorer" });
    await expect(explorerNav.getByRole("link")).toHaveText(["Overview", "Benchmarks", "Platforms", "Compare", "Find runs"]);
  });

  test("@smoke preserves the global header contract behind the mobile disclosure", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/results/");
    await waitForShell(page);

    const toggle = page.getByRole("button", { name: HEADER_TOGGLE_ARIA_LABEL });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("navigation", { name: HEADER_NAV_ARIA_LABEL }).getByRole("link")).toHaveText(GLOBAL_LABELS);
  });

  test("@smoke persists the theme choice from the footer theme button", async ({ page }) => {
    await page.goto("/results/");
    await waitForShell(page);

    await chooseTheme(page, "light");
    await page.reload();
    await waitForShell(page);
    await expect(page.locator("html")).toHaveAttribute("data-bb-theme-choice", "light");
    await expect(page.getByRole("button", { name: "Color theme: Light theme" })).toBeVisible();
  });

  test("Results global header bounding-box meets shared min-height contract", async ({ page }) => {
    await page.goto("/results/");
    await waitForShell(page);

    const headerBox = await page.getByTestId("benchbox-global-header").boundingBox();
    expect(headerBox).not.toBeNull();
    expect(headerBox!.height).toBeGreaterThanOrEqual(HEADER_DESKTOP_MIN_HEIGHT_PX - 0.5);
    expect(headerBox!.height).toBeLessThanOrEqual(HEADER_DESKTOP_MIN_HEIGHT_PX + HEADER_HEIGHT_TOLERANCE_PX);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileBox = await page.getByTestId("benchbox-global-header").boundingBox();
    expect(mobileBox).not.toBeNull();
    expect(mobileBox!.height).toBeGreaterThanOrEqual(HEADER_MOBILE_MIN_HEIGHT_PX - 0.5);
  });

  test("Results global header bounding-box is identical across light and dark themes", async ({ page }) => {
    await page.goto("/results/");
    await waitForShell(page);

    const measure = async () => {
      const box = await page.getByTestId("benchbox-global-header").boundingBox();
      expect(box).not.toBeNull();
      return box!;
    };

    await chooseTheme(page, "light");
    const lightBox = await measure();

    await chooseTheme(page, "dark");
    const darkBox = await measure();

    expect(Math.abs(darkBox.height - lightBox.height)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(darkBox.width - lightBox.width)).toBeLessThanOrEqual(0.5);
  });

  test("Results renders no Explorer subnav links inside the global header", async ({ page }) => {
    await page.goto("/results/");
    await waitForShell(page);

    const globalNav = page.getByRole("navigation", { name: HEADER_NAV_ARIA_LABEL });
    for (const subnavLabel of ["Overview", "Benchmarks", "Platforms", "Compare", "Find runs"]) {
      await expect(globalNav.getByRole("link", { name: subnavLabel, exact: true })).toHaveCount(0);
    }
  });
});
