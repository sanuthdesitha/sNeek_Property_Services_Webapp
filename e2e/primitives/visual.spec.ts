import { test, expect } from "@playwright/test";

// Visual regression baseline for the primitives catalog.
// First run: locks the screenshots. Subsequent runs: diff against baseline.
// Requires admin login — uses bootstrap admin from seed.

test.describe("primitives visual @visual", () => {
  test.beforeEach(async ({ page }) => {
    // Log in as admin
    await page.goto("/login");
    await page.fill("input#email", process.env.BASELINE_ADMIN_EMAIL ?? "admin@sneekproservices.com.au");
    await page.fill("input#password", process.env.BASELINE_ADMIN_PASSWORD ?? "admin123");
    await page.click("button[type=submit]");
    // Login redirects to "/" (or "/admin" for admin recovery mode); wait for any post-login nav
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 });
  });

  test("primitives catalog desktop @visual", async ({ page }) => {
    await page.goto("/dev/primitives");
    await page.waitForLoadState("networkidle");
    // Hide the FAB in screenshots (it's fixed-position and overlaps content)
    await page.evaluate(() => {
      document.querySelectorAll('section#fab button').forEach((el) => {
        (el as HTMLElement).style.display = 'none';
      });
    });
    await expect(page).toHaveScreenshot("primitives-desktop.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });
});
