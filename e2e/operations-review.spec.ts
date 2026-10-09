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
        path: `/workspace/scratch/operations-review/${name}-${width}-${dark ? "dark" : "light"}.png`,
        fullPage: true,
      });
    }
  }
}

test("job progress, laundry detail/filter parity and delegated PIN corrections", async ({ browser }) => {
  const context = await login(browser, admin);
  const page = await context.newPage();
  await db.laundryTask.create({ data: { jobId: job, propertyId: property, status: "CONFIRMED", pickupDate: new Date("2026-10-09T00:00:00Z"), dropoffDate: new Date("2026-10-10T00:00:00Z"), bagWeightKg: 4, adminOverrideNote: "Fixture handoff note" } });
  const invoice = await db.clientInvoice.create({ data: { clientId: client, invoiceNumber: `TEST-${job}`, status: "SENT", xeroInvoiceId: `XERO-${job}`, xeroExportedAt: new Date(), totalAmount: 50 } });
  await page.goto(`${origin}/v2/admin/jobs/${job}`);
  await expect(page.getByRole("progressbar", { name: "Job workflow" })).toHaveAttribute("aria-valuenow", "0");
  await screenshots(page, "job");
  await page.goto(`${origin}/v2/admin/laundry`);
  await expect(page.getByText("Navigation fixture property", { exact: false })).toBeVisible();
  await page.getByText("Handoff and job details", { exact: true }).click();
  await expect(page.getByText("Override: Fixture handoff note")).toBeVisible();
  await screenshots(page, "laundry");
  await page.getByLabel("Search", { exact: true }).fill("no matching property");
  await expect(page.getByText("No laundry scheduled", { exact: true })).toBeVisible();
  await page.getByLabel("Search", { exact: true }).fill("");
  await page.getByText("Handoff and job details", { exact: true }).click();
  await page.getByRole("button", { name: "Task report / PDF", exact: true }).click();
  await expect(page.getByText(/Report for Navigation fixture property/)).toBeVisible();
  await page.goto(`${origin}/v2/admin/settings?tab=roles`);
  await expect(page.getByRole("checkbox", { name: "Delete jobs", exact: true })).not.toBeChecked();
  await page.getByRole("checkbox", { name: "Reconcile Xero invoice corrections", exact: true }).check();
  await page.getByRole("button", { name: "Save permissions", exact: true }).click();
  await expect(page.getByText(/Permissions saved/)).toBeVisible();
  await screenshots(page, "permissions");
  await page.goto(`${origin}/v2/admin/finance?tab=invoices`);
  await page.getByRole("button", { name: "Reconcile / void", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await screenshots(page, "invoice-correction");
  const managerContext = await login(browser, manager);
  const pin = await managerContext.request.post(`${origin}/api/me/admin-pin`, { data: { currentPassword: password, pin: "8246" } });
  expect(pin.status()).toBe(200);
  expect((await managerContext.request.delete(`${origin}/api/admin/jobs/${job}`, { data: { security: { pin: "8246" } } })).status()).toBe(403);
  const correction = await managerContext.request.post(`${origin}/api/admin/invoices/${invoice.id}/reconcile`, { data: { reason: "Fixture duplicate corrected externally", reference: "XERO-TEST-VOID", confirmedInXero: true, security: { pin: "8246" } } });
  expect(correction.status(), await correction.text()).toBe(200);
  const persisted = await db.clientInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
  expect(persisted.status).toBe("VOID");
  expect(persisted.xeroInvoiceId).toBe(`XERO-${job}`);
  expect(await db.auditLog.count({ where: { entityId: invoice.id, action: "CLIENT_INVOICE_XERO_RECONCILED_VOID", userId: manager } })).toBe(1);
  await managerContext.close();
  await context.close();
});
