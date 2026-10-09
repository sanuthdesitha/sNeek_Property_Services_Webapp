import { test, expect, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
const origin = process.env.SNEEK_TEST_SERVER_ORIGIN;
const database = process.env.SNEEK_TEST_DATABASE_URL;
test.skip(!origin || !database, "Requires isolated fixtures");
const [admin, manager, client, property, job] = Array.from({ length: 5 }, () =>
  randomUUID(),
);
const password = "Navigation-fixture-password-27!";
const key = "ops_feature_permissions_v1";
let db: PrismaClient;
let original: any;
let profilesBefore: any;
test.beforeAll(async () => {
  if (
    origin !== "http://localhost:3002" ||
    new URL(database!).hostname !== "127.0.0.1" ||
    new URL(database!).port !== "55439"
  )
    throw Error("Dedicated loopback fixtures required");
  db = new PrismaClient({ datasources: { db: { url: database } } });
  original = await db.appSetting.findUnique({ where: { key } });
  profilesBefore = await db.appSetting.findUnique({ where: { key: "user_extended_profiles_v1" } });
  await db.appSetting.deleteMany({ where: { key } });
  const passwordHash = await bcrypt.hash(password, 4);
  await db.user.createMany({
    data: [
      {
        id: admin,
        name: "Permission owner",
        email: `${admin}@example.invalid`,
        role: "ADMIN",
        passwordHash,
      },
      {
        id: manager,
        name: "Operations fixture manager",
        email: `${manager}@example.invalid`,
        role: "OPS_MANAGER",
        passwordHash,
      },
    ],
  });
  await db.client.create({
    data: { id: client, name: "Navigation fixture client" },
  });
  await db.property.create({
    data: {
      id: property,
      name: "Navigation fixture property",
      clientId: client,
      address: "Fixture",
      suburb: "Fixture",
    },
  });
  await db.job.create({
    data: {
      id: job,
      jobNumber: job,
      propertyId: property,
      jobType: "AIRBNB_TURNOVER",
      status: "UNASSIGNED",
      scheduledDate: new Date("2026-10-09"),
    },
  });
});
test.afterAll(async () => {
  if (!db) return;
  await db.appSetting.deleteMany({ where: { key: "user_extended_profiles_v1" } });
  if (profilesBefore) await db.appSetting.create({ data: profilesBefore });
  await db.appSetting.deleteMany({ where: { key } });
  if (original) await db.appSetting.create({ data: original });
  await db.notification.deleteMany({
    where: { userId: { in: [admin, manager] } },
  });
  await db.auditLog.deleteMany({ where: { userId: { in: [admin, manager] } } });
  await db.laundryTask.deleteMany({ where: { jobId: job } });
  await db.clientInvoice.deleteMany({ where: { clientId: client } });
  await db.job.deleteMany({ where: { id: job } });
  await db.property.deleteMany({ where: { id: property } });
  await db.client.deleteMany({ where: { id: client } });
  await db.user.deleteMany({ where: { id: { in: [admin, manager] } } });
  await db.$disconnect();
});
async function login(browser: Browser, id: string) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  const csrf = await (
    await context.request.get(`${origin}/api/auth/csrf`)
  ).json();
  await context.request.post(`${origin}/api/auth/callback/credentials`, {
    form: {
      email: `${id}@example.invalid`,
      password,
      csrfToken: csrf.csrfToken,
      json: "true",
      callbackUrl: `${origin}/v2/admin/settings`,
    },
  });
  return context;
}
async function screenshots(page: Page, name: string) {
  for (const dark of [false, true]) {
    await page.evaluate((value) => {
      document
        .querySelectorAll(".dark")
        .forEach((element) => element.classList.remove("dark"));
      document.documentElement.classList.toggle("dark", value);
      document.documentElement.classList.toggle("light", !value);
    }, dark);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        )
        .toBe(true);
      await expect
        .poll(() =>
          page
            .locator("[data-skin=estate]")
            .first()
            .evaluate((element) =>
              getComputedStyle(element)
                .getPropertyValue("--e-background")
                .trim(),
            ),
        )
        .toBe(dark ? "160 16% 6%" : "40 30% 96%");
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `/workspace/scratch/job-vectors/${name}-${width}-${dark ? "dark" : "light"}.png`,
        fullPage: true,
      });
    }
  }
}

test("vector workflow, live status and consolidated filters", async ({ browser }) => {
  const context = await login(browser, admin);
  const page = await context.newPage();
  await page.goto(`${origin}/v2/admin/jobs`);
  await expect(page.getByRole("textbox", { name: "Search jobs" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeEnabled({ timeout: 60_000 });
  await page.getByRole("textbox", { name: "Search jobs" }).fill(job);
  await expect(page.locator('[data-motion="plan"]').first()).toBeVisible({ timeout: 30_000 });
  await screenshots(page, "filters");
  const summary = page.locator("summary").filter({ hasText: "Filters ·" });
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Search jobs" })).not.toBeVisible();
  await db.job.update({ where: { id: job }, data: { status: "EN_ROUTE" } });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator('[data-motion="travel"]').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Jobs options" }).click();
  await page.getByRole("menuitem", { name: "View options" }).click();
  await expect(page.getByRole("heading", { name: "View options", exact: true })).toBeFocused();
  await expect(page.getByText("Team default", { exact: true })).toBeVisible();
  await screenshots(page, "view-options");
  await page.getByRole("button", { name: "Board view" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText("Team default", { exact: true })).not.toBeVisible();
  await expect(page.locator('[data-motion="travel"]').first()).toBeVisible();
  await screenshots(page, "board");
  await page.goto(`${origin}/v2/admin/jobs/${job}`);
  await expect(page.getByRole("progressbar", { name: "Job workflow" })).toHaveAttribute("aria-valuenow", "2", { timeout: 60_000 });
  await screenshots(page, "progress");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => page.locator('[data-motion="travel"] svg').evaluate(el => getComputedStyle(el).animationName)).toBe("none");
  await context.close();
});
