import { test as base, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

// Explicitly enabled local fixtures only. No existing accounts or records are
// modified; each test owns its account and personal preference key.
export const test = base.extend<{ localAdmin: { id: string; page: Page } }>({
  localAdmin: async ({ page }, use) => {
    if (process.env.SNEEK_E2E_LOCAL_FIXTURES !== "1") throw new Error("Enable local fixtures explicitly");
    const url = new URL(process.env.DATABASE_URL || "http://missing.invalid");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !["postgres:", "postgresql:"].includes(url.protocol)) {
      throw new Error("Browser fixtures require local PostgreSQL");
    }
    const db = new PrismaClient();
    const id = `e2e-admin-${randomUUID()}`;
    const email = `${id}@example.invalid`;
    const password = randomUUID();
    let created = false;
    try {
      await db.user.create({ data: { id, email, name: "Browser verification", role: "ADMIN", passwordHash: await bcrypt.hash(password, 10) } });
      created = true;
      await page.goto("/v2/login");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL(url => !url.pathname.includes("login"), { timeout: 90_000 });
      await use({ id, page });
    } finally {
      try {
        if (created) {
          await db.appSetting.deleteMany({ where: { key: `admin_jobs_views_v1:${id}` } });
          await db.user.deleteMany({ where: { id, email } });
          expect(await db.user.count({ where: { id } })).toBe(0);
        }
      } finally { await db.$disconnect(); }
    }
  },
});
export { expect };
