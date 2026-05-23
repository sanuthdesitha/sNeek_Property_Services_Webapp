import { test, expect } from "@playwright/test";

test("home page responds", async ({ page }) => {
  await page.goto("/");
  // The public marketing site at "/" always renders some heading.
  await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 10_000 });
});
