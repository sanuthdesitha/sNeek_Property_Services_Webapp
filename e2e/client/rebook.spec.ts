import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

test.skip(process.env.SNEEK_E2E_LOCAL_FIXTURES !== "1", "Requires explicitly enabled loopback database fixtures");
test.setTimeout(180_000);

class RebookPage {
  constructor(private page: Page) {}
  async login(email: string, password: string) {
    await this.page.goto("/v2/login");
    await this.page.getByLabel("Email", { exact: true }).fill(email);
    await this.page.getByLabel("Password", { exact: true }).fill(password);
    await this.page.getByRole("button", { name: "Sign in", exact: true }).click();
    await this.page.waitForURL(url => !url.pathname.includes("login"), { timeout: 90_000 });
  }
  async open(id: string) { await this.page.goto(`/v2/client/booking?rebook=${encodeURIComponent(id)}`); }
  async next() { await this.page.getByRole("button", { name: "Continue", exact: true }).click(); }
  notes() { return this.page.getByLabel("Special instructions"); }
}

test("rebook starts from two authorized choices and does not copy the previous date or instructions", async ({ page }) => {
  if (process.env.SNEEK_E2E_LOCAL_FIXTURES !== "1") throw new Error("Enable local fixtures explicitly");
  const url = new URL(process.env.DATABASE_URL || "http://missing.invalid");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Browser fixtures require local PostgreSQL");
  const db = new PrismaClient();
  const id = `e2e-rebook-${randomUUID()}`;
  const email = `${id}@example.invalid`;
  const password = randomUUID();
  try {
    await db.client.create({ data: { id, name: "Rebook verification", portalVisibilityOverrides: { showBooking: true, showJobs: true } } });
    await db.user.create({ data: { id, email, name: "Rebook verification", role: "CLIENT", clientId: id, passwordHash: await bcrypt.hash(password, 10) } });
    await db.property.create({ data: { id, clientId: id, name: "Rebook property", address: "1 Fixture Street", suburb: "Sydney" } });
    await db.job.create({ data: { id, jobNumber: id, propertyId: id, jobType: "DEEP_CLEAN", status: "COMPLETED", scheduledDate: new Date("2026-01-01T00:00:00Z"), notes: "Historical private instructions", fixedPrice: 99 } });
    await page.route("**/api/client/available-slots?**", route => route.fulfill({ json: { available: ["2099-09-10"], windowStart: "2099-09-01", windowEnd: "2099-09-30" } }));
    await page.route("**/api/client/booking-review?**", route => route.fulfill({ status: 503, json: { error: "Review temporarily unavailable" } }));
    const rebook = new RebookPage(page);
    await rebook.login(email, password);
    await rebook.open(id);
    await expect(page.getByText("Rebook a previous clean", { exact: true })).toBeVisible();
    await rebook.next();
    await rebook.next();
    await expect(rebook.notes()).toHaveValue("");
    await expect(page.getByText("Historical private instructions")).toHaveCount(0);
    await expect(page.getByText("Deep Cleaning", { exact: true })).toBeVisible();
  } finally {
    await db.job.deleteMany({ where: { id, jobNumber: id } });
    await db.property.deleteMany({ where: { id, clientId: id } });
    await db.user.deleteMany({ where: { id, email } });
    await db.client.deleteMany({ where: { id } });
    await db.$disconnect();
  }
});
