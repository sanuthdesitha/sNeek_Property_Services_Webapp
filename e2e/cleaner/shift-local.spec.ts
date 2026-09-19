import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { formatInTimeZone } from "date-fns-tz";

test.skip(process.env.SNEEK_E2E_LOCAL_FIXTURES !== "1", "Requires explicitly enabled loopback database fixtures");
test.setTimeout(180_000);
test("Today combines personal offers, accepted route order and active work", async ({ page }) => {
  const url = new URL(process.env.DATABASE_URL || "http://missing.invalid");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Requires local PostgreSQL");
  const db = new PrismaClient(); const id = `e2e-shift-${randomUUID()}`; const email = `${id}@example.invalid`; const password = randomUUID();
  const day = formatInTimeZone(new Date(), "Australia/Sydney", "yyyy-MM-dd"); const date = new Date(`${day}T00:00:00Z`); const future = new Date(date.getTime() + 21 * 86400000);
  const jobs = ["alpha", "beta", "pending", "future"].map(suffix => `${id}-${suffix}`);
  try {
    await db.user.create({ data: { id, email, name: "Shift verification", role: "CLEANER", passwordHash: await bcrypt.hash(password, 10) } });
    await db.client.create({ data: { id, name: "Shift fixture client" } });
    await db.property.create({ data: { id, clientId: id, name: "Shift fixture property", address: "1 Fixture Street", suburb: "Sydney" } });
    for (let index = 0; index < jobs.length; index++) await db.job.create({ data: {
      id: jobs[index], jobNumber: jobs[index], propertyId: id, jobType: "GENERAL_CLEAN", status: index === 1 ? "IN_PROGRESS" : "ASSIGNED", scheduledDate: index === 3 ? future : date, startTime: index === 0 ? "09:00" : "11:00",
      assignments: { create: { userId: id, responseStatus: index < 2 ? "ACCEPTED" : "PENDING" } },
    } });
    await db.timeLog.create({ data: { id: `${id}-clock`, jobId: jobs[1], userId: id, startedAt: new Date(Date.now() - 300_000) } });
    await page.addInitScript(({ key, order }) => {
      localStorage.setItem(key, JSON.stringify(order));
      Object.defineProperty(navigator, "geolocation", { configurable: true, value: { watchPosition: () => 1, clearWatch: () => {}, getCurrentPosition: (_success: unknown, failure: (value: unknown) => void) => failure({ code: 1, message: "Synthetic test does not collect location" }) } });
    }, { key: `sneek_route_order_${id}_${day}`, order: [jobs[1], jobs[0]] });
    // No weather or briefing provider calls are needed to verify shift navigation.
    await page.route("**/api/cleaner/briefing?**", route => route.fulfill({ status: 503, json: { error: "Fixture does not call briefing providers" } }));
    await page.goto("/v2/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(password); await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(value => !value.pathname.includes("login"), { timeout: 90_000 }); await page.goto("/v2/cleaner");
    await expect(page.getByText("2 accepted jobs today.", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/2 pending offers\./)).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept", exact: true })).toHaveCount(2, { timeout: 30_000 });
    const route = page.getByRole("region", { name: "Today's route" });
    await expect(route.getByRole("listitem")).toHaveCount(2);
    await expect(route.getByRole("listitem").first().getByRole("link", { name: "Shift fixture property" })).toHaveAttribute("href", `/v2/cleaner/jobs/${jobs[1]}`);
    await expect(page.getByRole("region", { name: "Active job", exact: true }).getByRole("link", { name: "Resume job" })).toHaveAttribute("href", `/v2/cleaner/jobs/${jobs[1]}`, { timeout: 30_000 });
    await expect(page.getByText("Your clock: running.", { exact: true })).toBeVisible();
    await expect(page.getByText("No pending evidence found on this device.", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole("button", { name: "Pin Jobs", exact: true }).click();
    await page.getByRole("button", { name: "Favorites", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search navigation" }).fill("no fixture destination");
    await expect(page.getByRole("status").filter({ hasText: "No matching pages" })).toBeVisible();
    await page.getByRole("button", { name: "Show all pages", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unpin Jobs", exact: true })).toBeVisible();
    await page.reload();
    if (await menu.isVisible()) await menu.click();
    await expect(page.getByRole("button", { name: "Favorites", exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: "Unpin Jobs", exact: true })).toBeVisible();
  } finally {
    await db.timeLog.deleteMany({ where: { id: `${id}-clock`, jobId: jobs[1], userId: id } });
    await db.jobAssignment.deleteMany({ where: { jobId: { in: jobs }, userId: id } });
    await db.job.deleteMany({ where: { id: { in: jobs }, propertyId: id } });
    await db.property.deleteMany({ where: { id, clientId: id } }); await db.client.deleteMany({ where: { id } }); await db.user.deleteMany({ where: { id, email } }); await db.$disconnect();
  }
});
