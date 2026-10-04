import { captureOperationsLayout } from "./operations-layout";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
const origin = process.env.SNEEK_TEST_SERVER_ORIGIN, database = process.env.SNEEK_TEST_DATABASE_URL;
test.skip(!origin || !database, "Requires isolated fixture server and database");
const [admin, cleaner, client, property, job] = Array.from({ length: 5 }, () => randomUUID());
const password = "Care-fixture-password-27!";
let db: PrismaClient;
test.beforeAll(async () => {
  if (origin !== "http://localhost:3002" || new URL(database!).hostname !== "127.0.0.1" || new URL(database!).port !== "55439") throw Error("Dedicated loopback fixtures required");
  db = new PrismaClient({ datasources: { db: { url: database } } });
  const passwordHash = await bcrypt.hash(password, 4);
  await db.user.createMany({ data: [{ id: admin, email: `${admin}@example.invalid`, role: "ADMIN", passwordHash }, { id: cleaner, email: `${cleaner}@example.invalid`, role: "CLEANER", hourlyRate: 40, passwordHash }] });
  await db.client.create({ data: { id: client, name: "Jackson" } });
  await db.property.create({ data: { id: property, name: "Browser fixture property", clientId: client, address: "Fixture", suburb: "Fixture", inventoryEnabled: true } });
  await db.propertyClientRate.create({ data: { propertyId: property, jobType: "AIRBNB_TURNOVER", baseCharge: 100 } });
  await db.job.create({ data: { id: job, jobNumber: job, propertyId: property, jobType: "AIRBNB_TURNOVER", status: "ASSIGNED", scheduledDate: new Date(Date.now() + 2 * 86400000), startTime: "09:00", endTime: "11:00", estimatedHours: 2, assignments: { create: { userId: cleaner, payRate: 40, responseStatus: "ACCEPTED" } } } });
});
test.afterAll(async () => {
  if (!db) return;
  // This is an empty, disposable database; no production or shared data allowed.
  await db.appSetting.deleteMany({ where: { key: { startsWith: "property_care_v1:" } } });
  await db.notification.deleteMany({ where: { userId: { in: [admin, cleaner] } } });
  await db.auditLog.deleteMany({ where: { userId: { in: [admin, cleaner] } } });
  await db.clientInvoice.deleteMany({ where: { clientId: client } });
  await db.propertyClientRate.deleteMany({ where: { propertyId: property } });
  await db.jobTask.deleteMany({ where: { propertyId: property } });
  await db.jobAssignment.deleteMany({ where: { jobId: job } }); await db.job.delete({ where: { id: job } });
  await db.property.delete({ where: { id: property } }); await db.client.delete({ where: { id: client } });
  await db.user.deleteMany({ where: { id: { in: [admin, cleaner] } } }); await db.$disconnect();
});


test("office captures memory, configures inspection with paid time, and keeps unverified work separate", async ({ browser }) => {
 const context = await browser.newContext();
 await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
 const csrf = await (await context.request.get(`${origin}/api/auth/csrf`)).json();
 await context.request.post(`${origin}/api/auth/callback/credentials`, { form: { email: `${admin}@example.invalid`, password, csrfToken: csrf.csrfToken, json: "true", callbackUrl: `${origin}/property-care?propertyId=${property}` } });
 const page = await context.newPage(); await page.goto(`${origin}/property-care?propertyId=${property}`);
 await page.getByLabel("Reason for this change").fill("Owner approved periodic inspection and booked minutes");
 await page.getByLabel("Property memory note").fill("Curtain in bedroom requires gentle care"); await page.getByRole("button", { name: "Record note", exact: true }).click();
 await expect(page.getByText(/Memory: Curtain in bedroom/)).toBeVisible();
 await page.getByRole("button", { name: "Configure new asset or area" }).click();
 await page.getByLabel("Named asset/location").fill("Bedroom curtain"); await page.getByRole("combobox", { name: /^Applicability/ }).selectOption("APPLICABLE");
 await page.getByLabel("Enable this periodic care").check(); await page.getByLabel("Safe reachable access confirmed; no specialist work").check(); await page.getByLabel("Approved products and applicable instructions available").check();
 await page.getByRole("button", { name: "Save asset care", exact: true }).click(); await expect(page.getByText(/Last inspected: Unknown/)).toBeVisible();
 await page.getByRole("button", { name: "Attach due care to suitable jobs", exact: true }).click();
 expect(await db.jobTask.count({ where: { propertyId: property } })).toBe(0);
 await page.getByRole("combobox", { name: /^Future job/ }).selectOption(job); await page.getByLabel("Paid care budget minutes").fill("10");
 await page.getByLabel("Access, supplies and paid booking approved for these tasks").check(); await page.getByRole("button", { name: "Save booked care time" }).click();
 await page.getByRole("button", { name: "Attach due care to suitable jobs", exact: true }).click();
 await expect(page.getByText("Inspect: Curtains, each room — Bedroom curtain", { exact: true })).toBeVisible();
 await page.getByRole("button", { name: "Attach due care to suitable jobs", exact: true }).click();
 expect(await db.jobTask.count({ where: { propertyId: property } })).toBe(1);
 const task = await db.jobTask.findFirstOrThrow({ where: { propertyId: property } });
 await db.jobTask.update({ where: { id: task.id }, data: { executionStatus: "COMPLETED", completedAt: new Date() } });
 await page.reload(); await expect(page.getByRole("heading", { name: "Work reported complete — evidence missing" })).toBeVisible();
 await expect(page.getByText(/Last inspected: Unknown/)).toBeVisible();
 expect((await context.request.post(`${origin}/api/property-care`, { headers: { origin: "https://other.invalid" }, data: { action: "plan", propertyId: property } })).status()).toBe(403);
 await page.screenshot({ path: "/workspace/device-checkpoint/care-browser.png", fullPage: true });
 await expect(page.getByText(/Inspection due: Initial inspection needed/)).toBeVisible();
 await expect(page.getByText(/INITIAL_INSPECTION/)).toHaveCount(0);
 await captureOperationsLayout(page,"care");
 await context.close();
});
