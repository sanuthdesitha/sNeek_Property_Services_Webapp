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
test.beforeAll(async () => {
  if (
    origin !== "http://localhost:3002" ||
    new URL(database!).hostname !== "127.0.0.1" ||
    new URL(database!).port !== "55439"
  )
    throw Error("Dedicated loopback fixtures required");
  db = new PrismaClient({ datasources: { db: { url: database } } });
  original = await db.appSetting.findUnique({ where: { key } });
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
  await db.appSetting.deleteMany({ where: { key } });
  if (original) await db.appSetting.create({ data: original });
  await db.notification.deleteMany({
    where: { userId: { in: [admin, manager] } },
  });
  await db.auditLog.deleteMany({ where: { userId: { in: [admin, manager] } } });
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
async function screenshots(page: Page) {
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
        path: `/workspace/scratch/navigation-permissions/roles-${width}-${dark ? "dark" : "light"}.png`,
        fullPage: true,
      });
    }
  }
}
test("return navigation restores Jobs views and detail tabs; refresh resets temporary choices", async ({
  browser,
}) => {
  const context = await login(browser, admin);
  const page = await context.newPage();
  await page.goto(`${origin}/v2/admin/jobs`);
  await page.getByRole("button", { name: "Jobs options" }).click();
  await page.getByRole("menuitem", { name: "View options" }).click();
  await page.getByRole("button", { name: "Board view", exact: true }).click();
  await expect(page).toHaveURL(/view=board/);
  await page.goto(`${origin}/v2/admin/jobs/${job}?tab=money`);
  await expect(page).toHaveURL(/tab=money/);
  await page
    .getByRole("link", { name: "Back to jobs board", exact: true })
    .click();
  await expect(page).toHaveURL(/view=board/);
  await page.getByRole("button", { name: "Jobs options" }).click();
  await page.getByRole("menuitem", { name: "View options" }).click();
  await expect(
    page.getByRole("button", { name: "Board view", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.goto(`${origin}/v2/admin/jobs/${job}`);
  await expect(page).toHaveURL(/tab=money/);
  await page.goto(`${origin}/v2/admin/jobs`);
  await expect(page).toHaveURL(/view=board/);
  await page.reload();
  await page.getByRole("button", { name: "Jobs options" }).click();
  await page.getByRole("menuitem", { name: "View options" }).click();
  await expect(
    page.getByRole("button", { name: "List view", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(new URL(page.url()).searchParams.get("view")).not.toBe("board");
  await context.close();
});
test("permission packs save in settings and enforce live feature reads and writes", async ({
  browser,
}) => {
  const owner = await login(browser, admin);
  const page = await owner.newPage();
  await page.goto(`${origin}/v2/admin/settings?tab=roles`);
  await page
    .getByRole("combobox", { name: "Operations manager", exact: true })
    .selectOption(manager);
  await page
    .getByRole("combobox", { name: "Assigned permission pack", exact: true })
    .selectOption("observer");
  await page
    .getByLabel("Jobs & assignments", { exact: true })
    .selectOption("off");
  await page
    .getByRole("button", { name: "Save permissions", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Permissions saved" }),
  ).toBeVisible();
  await page.getByLabel("Find a feature", { exact: true }).fill("jobs");
  await screenshots(page);
  const ops = await login(browser, manager);
  expect((await ops.request.get(`${origin}/api/jobs`)).status()).toBe(403);
  expect(
    (
      await ops.request.patch(`${origin}/api/admin/jobs/${job}`, { data: {} })
    ).status(),
  ).toBe(403);
  expect(
    (
      await ops.request.put(`${origin}/api/admin/ops-permissions`, { data: {} })
    ).status(),
  ).toBe(403);
  const opsPage = await ops.newPage();
  await opsPage.goto(`${origin}/v2/admin/jobs`);
  await expect(
    opsPage.getByRole("heading", { name: "Feature access is turned off" }),
  ).toBeVisible();
  await expect(opsPage.locator('a[href="/v2/admin/jobs"]')).toHaveCount(0);
  await page
    .getByLabel("Jobs & assignments", { exact: true })
    .selectOption("read");
  await page
    .getByRole("button", { name: "Save permissions", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Permissions saved" }),
  ).toBeVisible();
  expect((await ops.request.get(`${origin}/api/jobs`)).status()).toBe(200);
  expect(
    (
      await ops.request.patch(`${origin}/api/admin/jobs/${job}`, { data: {} })
    ).status(),
  ).toBe(403);
  await page
    .getByLabel("Jobs & assignments", { exact: true })
    .selectOption("manage");
  await page
    .getByRole("button", { name: "Save permissions", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Permissions saved" }),
  ).toBeVisible();
  // Manage must reach the real revision-protected job update.
  const currentJob = await (
    await ops.request.get(`${origin}/api/admin/jobs/${job}`)
  ).json();
  const result = await ops.request.patch(`${origin}/api/admin/jobs/${job}`, {
    data: {
      notes: "Permission fixture update",
      expectedUpdatedAt: currentJob.updatedAt,
    },
  });
  expect(result.status()).toBe(200);
  await ops.close();
  await owner.close();
});
