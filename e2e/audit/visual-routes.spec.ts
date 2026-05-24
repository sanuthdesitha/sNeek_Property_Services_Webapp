import { test, expect, Page } from "@playwright/test";

const ROUTES = [
  { path: "/", name: "public-home", needsAuth: false },
  { path: "/login", name: "login", needsAuth: false },
  { path: "/services", name: "public-services", needsAuth: false },
  { path: "/quote", name: "public-quote", needsAuth: false },
  { path: "/admin", name: "admin-home", needsAuth: true },
  { path: "/admin/jobs", name: "admin-jobs", needsAuth: true },
  { path: "/admin/calendar", name: "admin-calendar", needsAuth: true },
  { path: "/admin/clients", name: "admin-clients", needsAuth: true },
  { path: "/admin/quotes", name: "admin-quotes", needsAuth: true },
  { path: "/admin/finance", name: "admin-finance", needsAuth: true },
  { path: "/admin/settings", name: "admin-settings", needsAuth: true },
  { path: "/admin/system/uploads", name: "admin-uploads-failures", needsAuth: true },
  { path: "/admin/system/email", name: "admin-email-system", needsAuth: true },
  { path: "/dev/primitives", name: "dev-primitives", needsAuth: true },
];

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.fill("input#email", process.env.BASELINE_ADMIN_EMAIL ?? "admin@sneekproservices.com.au");
  await page.fill("input#password", process.env.BASELINE_ADMIN_PASSWORD ?? "admin123");
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }),
    page.click("button[type=submit]"),
  ]);
}

test.describe("visual baseline @visual", () => {
  test.setTimeout(180_000);

  for (const route of ROUTES) {
    test(`${route.name} renders`, async ({ page }) => {
      if (route.needsAuth) {
        await loginAsAdmin(page);
      }
      try {
        await page.goto(route.path);
        await page.waitForLoadState("networkidle", { timeout: 10_000 });
      } catch {
        // Some routes redirect or are slow; carry on
      }
      // Hide elements that vary by run
      await page.evaluate(() => {
        document.querySelectorAll('[data-volatile], time, .clock').forEach((el) => {
          (el as HTMLElement).style.visibility = 'hidden';
        });
      });
      await expect(page).toHaveScreenshot(`${route.name}-${test.info().project.name}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.02,
        timeout: 30_000,
        animations: "disabled",
      });
    });
  }
});
