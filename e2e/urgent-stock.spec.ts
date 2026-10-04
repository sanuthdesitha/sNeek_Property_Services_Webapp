import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
const origin = process.env.SNEEK_TEST_SERVER_ORIGIN, database = process.env.SNEEK_TEST_DATABASE_URL;
test.skip(!origin || !database, "Requires isolated fixture server and database");
const [admin, cleaner, client, property, item, job] = Array.from({ length: 6 }, () => randomUUID());
const password = "Stock-fixture-password-27!";
let db: PrismaClient;
test.beforeAll(async () => {
  if (origin !== "http://localhost:3002" || new URL(database!).hostname !== "127.0.0.1" || new URL(database!).port !== "55439") throw Error("Dedicated loopback fixtures required");
  db = new PrismaClient({ datasources: { db: { url: database } } });
  const passwordHash = await bcrypt.hash(password, 4);
  await db.user.createMany({ data: [{ id: admin, email: `${admin}@example.invalid`, role: "ADMIN", passwordHash }, { id: cleaner, email: `${cleaner}@example.invalid`, role: "CLEANER", passwordHash }] });
  await db.client.create({ data: { id: client, name: "Browser fixture client" } });
  await db.property.create({ data: { id: property, name: "Browser fixture property", clientId: client, address: "Fixture", suburb: "Fixture", inventoryEnabled: true } });
  await db.inventoryItem.create({ data: { id: item, name: "Browser paper", category: "Fixture" } });
  await db.propertyStock.create({ data: { propertyId: property, itemId: item, onHand: 10, updatedAt: new Date(Date.now() - 3600000) } });
  await db.job.create({ data: { id: job, jobNumber: job, propertyId: property, jobType: "AIRBNB_TURNOVER", status: "ASSIGNED", scheduledDate: new Date(), assignments: { create: { userId: cleaner, responseStatus: "ACCEPTED" } } } });
});
test.afterAll(async () => {
  if (!db) return;
  // This is an empty, disposable database; no production or shared data allowed.
  await db.appSetting.deleteMany({ where: { key: { startsWith: "urgent_stock_v1:" } } });
  await db.notification.deleteMany({ where: { userId: { in: [admin, cleaner] } } });
  await db.auditLog.deleteMany({ where: { userId: { in: [admin, cleaner] } } });
  await db.stockTx.deleteMany({ where: { propertyStock: { propertyId: property } } });
  await db.propertyStock.deleteMany({ where: { propertyId: property } });
  await db.jobAssignment.deleteMany({ where: { jobId: job } }); await db.job.delete({ where: { id: job } });
  await db.property.delete({ where: { id: property } }); await db.client.delete({ where: { id: client } }); await db.inventoryItem.delete({ where: { id: item } });
  await db.user.deleteMany({ where: { id: { in: [admin, cleaner] } } }); await db.$disconnect();
});
test("cleaner reports unknown supply, records open stages, confirms actual count, and loses access on removal", async ({ browser }) => {
  const context = await browser.newContext();
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const csrf = await (await context.request.get(`${origin}/api/auth/csrf`)).json();
  await context.request.post(`${origin}/api/auth/callback/credentials`, { form: { email: `${cleaner}@example.invalid`, password, csrfToken: csrf.csrfToken, json: "true", callbackUrl: `${origin}/urgent-stock` } });
  const page = await context.newPage(); await page.goto(`${origin}/urgent-stock?propertyId=${property}`);
  await page.getByRole("combobox", { name: "Item", exact: true }).selectOption(item);
  await page.getByLabel("What is needed and why?").fill("Paper needed, actual quantity unknown");
  await page.getByRole("button", { name: "Save report", exact: true }).click();
  const card = page.locator("article"); await expect(card).toContainText("Browser paper — Reported");
  await expect(card).toContainText("Reported count: unknown");
  expect((await db.propertyStock.findUniqueOrThrow({ where: { propertyId_itemId: { propertyId: property, itemId: item } } })).onHand).toBe(10);
  for (const [value, label] of [["ACKNOWLEDGED", "Acknowledged"], ["ORDERED", "Order recorded"], ["DELIVERED", "Delivery recorded"]]) {
    await card.getByRole("combobox", { name: "Record action", exact: true }).selectOption(value);
    await card.getByLabel("Action reason").fill(`Fixture ${label}`);
    await card.getByRole("button", { name: "Record action", exact: true }).click();
    await expect(card.getByRole("heading")).toHaveText(`Browser paper — ${label}`);
    await expect(card.getByRole("button", { name: "Record action", exact: true })).toBeVisible();
  }
  await card.getByRole("combobox", { name: "Record action", exact: true }).selectOption("PROPERTY_CONFIRMED");
  await card.getByLabel("Fresh observed count").fill("12");
  const localTime = await page.evaluate(() => { const date = new Date(); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); });
  await card.getByLabel("Observation time", { exact: true }).fill(localTime);
  await card.getByLabel("I checked the property and this need is resolved").check();
  await card.getByLabel("Action reason").fill("Fresh count at property meets the need");
  await card.getByRole("button", { name: "Record action", exact: true }).click();
  await expect(card.getByRole("heading")).toHaveText("Browser paper — Confirmed at property");
  expect((await db.propertyStock.findUniqueOrThrow({ where: { propertyId_itemId: { propertyId: property, itemId: item } } })).onHand).toBe(12);
  await card.getByRole("button", { name: "View history" }).click(); await expect(card.locator("li")).toHaveCount(5);
  await page.screenshot({ path: "/tmp/sneek-urgent-stock-browser.png", fullPage: true });
  await db.jobAssignment.updateMany({ where: { jobId: job }, data: { removedAt: new Date() } });
  expect((await context.request.get(`${origin}/api/inventory/urgent-stock?propertyId=${property}`)).status()).toBe(403);
  expect(await page.evaluate(async () => (await fetch("/api/inventory/urgent-stock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "settings", enabled: true, intervalHours: 1, maxReminders: 1, beforeNextCleanHours: 1 }) })).status)).toBe(403);
  await context.close();
});
