import { test as base, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

export const test = base.extend<{ localClient: { id: string; clientId: string; page: Page; db: PrismaClient } }>({
  localClient: async ({ page }, use) => {
    if (process.env.SNEEK_E2E_LOCAL_FIXTURES !== "1") throw new Error("Enable local fixtures explicitly");
    const url = new URL(process.env.DATABASE_URL || "http://missing.invalid");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !["postgres:", "postgresql:"].includes(url.protocol)) {
      throw new Error("Browser fixtures require local PostgreSQL");
    }
    const db = new PrismaClient();
    const id = `e2e-client-${randomUUID()}`;
    const clientId = `${id}-account`;
    const email = `${id}@example.invalid`;
    const password = randomUUID();
    let created = false;
    try {
      await db.client.create({ data: { id: clientId, name: "Isolated browser client",
        portalVisibilityOverrides: { showFinanceDetails: true, showProperties: true, showBooking: true },
        users: { create: { id, email, name: "Browser client", role: "CLIENT", passwordHash: await bcrypt.hash(password, 10) } },
      } });
      created = true;
      await page.goto("/v2/login");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL(url => !url.pathname.includes("login"), { timeout: 90_000 });
      await use({ id, clientId, page, db });
    } finally {
      try {
        if (created) {
          await db.user.deleteMany({ where: { id, email } });
          await db.client.deleteMany({ where: { id: clientId } });
          expect(await db.user.count({ where: { id } })).toBe(0);
          expect(await db.client.count({ where: { id: clientId } })).toBe(0);
        }
      } finally { await db.$disconnect(); }
    }
  },
});
export { expect };
