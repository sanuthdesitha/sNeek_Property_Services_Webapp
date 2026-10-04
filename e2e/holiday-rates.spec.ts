import { captureOperationsLayout } from "./operations-layout";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
const origin = process.env.SNEEK_TEST_SERVER_ORIGIN, database = process.env.SNEEK_TEST_DATABASE_URL;
test.skip(!origin || !database, "Requires isolated fixture server and database");
const [admin, cleaner, client, property, job] = Array.from({ length: 5 }, () => randomUUID());
const password = "Holiday-fixture-password-27!";
let db: PrismaClient;
test.beforeAll(async () => {
  if (origin !== "http://localhost:3002" || new URL(database!).hostname !== "127.0.0.1" || new URL(database!).port !== "55439") throw Error("Dedicated loopback fixtures required");
  db = new PrismaClient({ datasources: { db: { url: database } } });
  const passwordHash = await bcrypt.hash(password, 4);
  await db.user.createMany({ data: [{ id: admin, email: `${admin}@example.invalid`, role: "ADMIN", passwordHash }, { id: cleaner, email: `${cleaner}@example.invalid`, role: "CLEANER", hourlyRate: 40, passwordHash }] });
  await db.client.create({ data: { id: client, name: "Jackson" } });
  await db.property.create({ data: { id: property, name: "Browser fixture property", clientId: client, address: "Fixture", suburb: "Fixture", inventoryEnabled: true } });
  await db.propertyClientRate.create({ data: { propertyId: property, jobType: "AIRBNB_TURNOVER", baseCharge: 100 } });
  await db.job.create({ data: { id: job, jobNumber: job, propertyId: property, jobType: "AIRBNB_TURNOVER", status: "ASSIGNED", scheduledDate: new Date("2026-10-05"), assignments: { create: { userId: cleaner, payRate: 40, responseStatus: "ACCEPTED" } } } });
});
test.afterAll(async () => {
  if (!db) return;
  // This is an empty, disposable database; no production or shared data allowed.
  await db.appSetting.deleteMany({ where: { key: { startsWith: "holiday_rates_v1:" } } });
  await db.notification.deleteMany({ where: { userId: { in: [admin, cleaner] } } });
  await db.auditLog.deleteMany({ where: { userId: { in: [admin, cleaner] } } });
  await db.clientInvoice.deleteMany({ where: { clientId: client } });
  await db.propertyClientRate.deleteMany({ where: { propertyId: property } });
  await db.jobAssignment.deleteMany({ where: { jobId: job } }); await db.job.delete({ where: { id: job } });
  await db.property.delete({ where: { id: property } }); await db.client.delete({ where: { id: client } });
  await db.user.deleteMany({ where: { id: { in: [admin, cleaner] } } }); await db.$disconnect();
});

test("admin reviews independent rates, applies once, reverts, and cannot change invoiced work; cleaner is isolated", async ({ browser }) => {
 const context = await browser.newContext();
 await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
 async function login(ctx: any, id: string) { const csrf = await (await ctx.request.get(`${origin}/api/auth/csrf`)).json(); await ctx.request.post(`${origin}/api/auth/callback/credentials`, { form: { email: `${id}@example.invalid`, password, csrfToken: csrf.csrfToken, json: "true", callbackUrl: `${origin}/v2/admin/settings/holiday-rates` } }); }
 await login(context, admin);
 const page = await context.newPage(); await page.goto(`${origin}/v2/admin/settings/holiday-rates?jobId=${job}`);
 await page.getByLabel("Reason for changes or job review").fill("Reviewed Jackson Labour Day rates");
 await page.getByRole("button", { name: "Preview holiday rates", exact: true }).click();
 await expect(page.getByText(/Client normal base/)).toContainText("$150.00");
 await expect(page.getByText(/normal \$40.00/)).toContainText("$50.00/hr");
 await page.getByRole("button", { name: "Apply reviewed job rates" }).click();
 await expect(page.getByRole("button", { name: "Revert unbilled holiday snapshot" })).toBeVisible();
 expect((await db.job.findUniqueOrThrow({ where: { id: job } })).fixedPrice).toBe(150);
 expect((await db.jobAssignment.findFirstOrThrow({ where: { jobId: job } })).payRate).toBe(50);
 await page.getByRole("button", { name: "Revert unbilled holiday snapshot" }).click();
 await expect(page.getByRole("button", { name: "Preview holiday rates", exact: true })).toBeVisible();
 expect((await db.job.findUniqueOrThrow({ where: { id: job } })).fixedPrice).toBeNull();
 // Force stale verified cache in the disposable fixture only.
 const cache = (await (await context.request.get(`${origin}/api/admin/holiday-rates`)).json()).calendar;
 await db.appSetting.upsert({ where: { key: "holiday_rates_v1:calendar:AU-NSW" }, create: { key: "holiday_rates_v1:calendar:AU-NSW", value: { ...cache, verifiedAt: "2000-01-01T00:00:00Z" } }, update: { value: { ...cache, verifiedAt: "2000-01-01T00:00:00Z" } } });
 await page.reload(); await page.getByLabel("Reason for changes or job review").fill("Review stale calendar fallback");
 await expect(page.getByRole("status").filter({ hasText: "Calendar is stale" })).toBeVisible();
 await page.getByRole("button", { name: "Preview holiday rates", exact: true }).click();
 await expect(page.getByRole("alert").filter({ hasText: "stale" })).toBeVisible();
 await page.getByLabel("Holiday decision").selectOption("HOLIDAY");
 await page.getByRole("button", { name: "Preview holiday rates", exact: true }).click();
 await expect(page.getByRole("button", { name: "Apply reviewed job rates" })).toBeVisible();
 await db.clientInvoice.create({ data: { clientId: client, invoiceNumber: randomUUID(), status: "SENT", subtotal: 100, gstAmount: 10, totalAmount: 110, lines: { create: { jobId: job, description: "Immutable fixture invoice", category: "CLEANING", unitPrice: 100, lineTotal: 100 } } } });
 await page.getByRole("button", { name: "Apply reviewed job rates" }).click();
 await expect(page.getByRole("alert").filter({ hasText: "client invoice" })).toBeVisible();
 expect((await db.job.findUniqueOrThrow({ where: { id: job } })).fixedPrice).toBeNull();
 expect((await context.request.post(`${origin}/api/admin/holiday-rates`, { headers: { origin: "https://other.invalid" }, data: { action: "refresh" } })).status()).toBe(403);
 const outsider = await browser.newContext(); await login(outsider, cleaner);
 expect((await outsider.request.get(`${origin}/api/admin/holiday-rates?jobId=${job}`)).status()).toBe(403);
 await page.screenshot({ path: "/workspace/device-checkpoint/holiday-browser.png", fullPage: true });
 await captureOperationsLayout(page,"holiday");
 await outsider.close(); await context.close();
});
