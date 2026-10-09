import { test, expect, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

const origin = process.env.SNEEK_TEST_SERVER_ORIGIN;
const database = process.env.SNEEK_TEST_DATABASE_URL;
test.skip(
  !origin || !database,
  "Requires the isolated fixture server and database",
);
test.setTimeout(120_000);
const [admin, manager, client, property, job] = Array.from({ length: 5 }, () =>
  randomUUID(),
);
const password = "Settings-fixture-password-27!";
let db: PrismaClient;

test.beforeAll(async () => {
  if (
    origin !== "http://localhost:3002" ||
    new URL(database!).hostname !== "127.0.0.1" ||
    new URL(database!).port !== "55439"
  )
    throw Error("Dedicated loopback fixtures required");
  db = new PrismaClient({ datasources: { db: { url: database } } });
  const passwordHash = await bcrypt.hash(password, 4);
  await db.user.createMany({
    data: [
      {
        id: admin,
        email: `${admin}@example.invalid`,
        role: "ADMIN",
        passwordHash,
      },
      {
        id: manager,
        email: `${manager}@example.invalid`,
        role: "OPS_MANAGER",
        passwordHash,
      },
    ],
  });
  await db.client.create({
    data: { id: client, name: "Settings fixture client" },
  });
  await db.property.create({
    data: {
      id: property,
      name: "Settings fixture property",
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
      scheduledDate: new Date("2026-10-05"),
    },
  });
});

test.afterAll(async () => {
  if (!db) return;
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

async function login(browser: Browser, user: string) {
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
      email: `${user}@example.invalid`,
      password,
      csrfToken: csrf.csrfToken,
      json: "true",
      callbackUrl: `${origin}/v2/admin/settings`,
    },
  });
  return context;
}

async function checkLayout(page: Page, name: string) {
  for (const dark of [false, true]) {
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("dark", value),
      dark,
    );
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        )
        .toBe(true);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const search = page.getByRole("searchbox", { name: "Search settings" });
      await search.focus();
      expect(
        await search.evaluate(
          (element) => element.getBoundingClientRect().height,
        ),
      ).toBeGreaterThanOrEqual(44);
      expect(
        await search.evaluate((element) => getComputedStyle(element).boxShadow),
      ).not.toBe("none");
      await expect(page.getByLabel("Go to setting")).toBeVisible({
        visible: width < 640,
      });
      if (process.env.SNEEK_VISUAL_OUTPUT) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: `${process.env.SNEEK_VISUAL_OUTPUT}/${name}-${width}-${dark ? "dark" : "light"}.png`,
          fullPage: true,
        });
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
}

test("settings directory, search, mobile navigation and old links share one workspace", async ({
  browser,
}) => {
  const context = await login(browser, admin);
  const page = await context.newPage();
  await page.goto(`${origin}/v2/admin/settings`);
  await expect(
    page.getByRole("heading", { name: "Browse settings" }),
  ).toBeVisible();
  await checkLayout(page, "settings-overview");
  await page
    .getByRole("searchbox", { name: "Search settings" })
    .fill("holiday multipliers");
  await page
    .getByRole("region", { name: "Settings search results" })
    .getByRole("link")
    .click();
  await expect(page).toHaveURL(/tab=holiday-rates/);
  await expect(
    page.getByRole("heading", { name: "Public holiday rates" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Reason for changes or job review"),
  ).toBeVisible();
  await checkLayout(page, "settings-money");
  await page.goto(`${origin}/v2/admin/settings/holiday-rates?jobId=${job}`);
  await expect(page).toHaveURL(
    `${origin}/v2/admin/settings?tab=holiday-rates&jobId=${job}`,
  );
  await expect(
    page.getByRole("button", { name: "Preview holiday rates", exact: true }),
  ).toBeVisible();
  await page.goto(`${origin}/admin/settings/holiday-rates?jobId=${job}`);
  await expect(page).toHaveURL(
    `${origin}/v2/admin/settings?tab=holiday-rates&jobId=${job}`,
  );
  await page.goto(`${origin}/v2/admin/settings/property-form`);
  await expect(page).toHaveURL(/tab=property-form/);
  await expect(
    page.getByRole("heading", { name: "Property form", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Go to setting").selectOption("laundry");
  await expect(page).toHaveURL(/tab=laundry/);
  await expect(
    page.getByText("Operational defaults", { exact: true }),
  ).toBeVisible();
  await checkLayout(page, "settings-laundry");
  await context.close();
});

test("operations managers keep their settings access without seeing admin-only rates", async ({
  browser,
}) => {
  const context = await login(browser, manager);
  const page = await context.newPage();
  await page.goto(`${origin}/v2/admin/settings?tab=holiday-rates`);
  await expect(
    page.getByRole("heading", { name: "Browse settings" }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search settings" })
    .fill("holiday");
  await expect(
    page.getByRole("status").filter({ hasText: "No settings found" }),
  ).toBeVisible();
  expect(
    (await context.request.get(`${origin}/api/admin/holiday-rates`)).status(),
  ).toBe(403);
  await page.goto(`${origin}/v2/admin/settings/property-form`);
  await expect(page).toHaveURL(/tab=property-form/);
  await expect(
    page.getByRole("heading", { name: "Property form", exact: true }),
  ).toBeVisible();
  await page.goto(`${origin}/v2/admin/jobs/${job}?tab=money`);
  await expect(
    page.getByRole("heading", { name: "Money & margin" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Review public holiday rates" }),
  ).toHaveCount(0);
  await context.close();
});

test("job rate actions stay in Money and optional bag tracking stays in Tracking", async ({
  browser,
}) => {
  const context = await login(browser, admin);
  const page = await context.newPage();
  await page.goto(`${origin}/v2/admin/jobs/${job}`);
  await expect(
    page.getByRole("link", { name: "Review public holiday rates" }),
  ).toHaveCount(0);
  await page.goto(`${origin}/v2/admin/jobs/${job}?tab=money`);
  await expect(
    page.getByRole("link", { name: "Review public holiday rates" }),
  ).toHaveAttribute(
    "href",
    `/v2/admin/settings?tab=holiday-rates&jobId=${job}`,
  );
  for (const section of ["queue", "runs"]) {
    await page.goto(`${origin}/v2/laundry/${section}`);
    await expect(
      page.getByRole("button", {
        name: "Track individual bags (optional)",
        exact: true,
      }),
    ).toHaveCount(0);
  }
  await page.goto(`${origin}/v2/laundry/tracking`);
  await page
    .getByRole("button", {
      name: "Track individual bags (optional)",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      /Use this optional log when bags have individual physical labels/,
    ),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await context.close();
});
