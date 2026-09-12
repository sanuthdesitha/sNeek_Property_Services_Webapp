import { test, expect } from "../fixtures/local-admin";
import { PrismaClient } from "@prisma/client";
import type { Page } from "@playwright/test";
const key = "admin_jobs_team_default_v1";
class JobsTeamDefaultPage {
  constructor(private page: Page) {}
  async open(query = "") { await this.page.goto(`/v2/admin/jobs${query}`); await expect(this.page.getByRole("button", { name: "Publish current view", exact: true })).toBeVisible({ timeout: 30_000 }); }
  async publish() { await this.page.getByRole("button", { name: "Publish current view", exact: true }).click(); await this.page.getByRole("button", { name: "Confirm publication", exact: true }).click(); await expect(this.page.getByText("Team default saved.", { exact: true })).toBeVisible(); }
  async remove() { await this.page.getByRole("button", { name: "Remove team default", exact: true }).click(); await this.page.getByRole("button", { name: "Confirm removal", exact: true }).click(); await expect(this.page.getByText("Team default saved.", { exact: true })).toBeVisible(); }
}
test.describe("Team Jobs default on an isolated database", () => {
  test.skip(process.env.SNEEK_E2E_LOCAL_FIXTURES !== "1", "Requires explicitly enabled loopback database fixtures");
  test.setTimeout(180_000);
  test("publishes an optional fallback while preserving explicit Jobs links", async ({ localAdmin }) => {
    const { page, id } = localAdmin;
    const db = new PrismaClient();
    try {
      // Never replace an existing team setting, even in the local fixture DB.
      expect(await db.appSetting.count({ where: { key } })).toBe(0);
      const team = new JobsTeamDefaultPage(page); await team.open("?jobsState=1");
      await page.getByRole("textbox", { name: "Search jobs", exact: true }).fill("Synthetic team default");
      await team.publish();
      expect((await db.appSetting.findUnique({ where: { key } }))?.value).toMatchObject({ updatedBy: id, snapshot: { search: "Synthetic team default" } });
      await team.open();
      await expect(page.getByRole("textbox", { name: "Search jobs", exact: true })).toHaveValue("Synthetic team default");
      await team.open("?search=Explicit&jobsState=1");
      await expect(page.getByRole("textbox", { name: "Search jobs", exact: true })).toHaveValue("Explicit");
      await team.remove();
      expect((await db.appSetting.findUnique({ where: { key } }))?.value).toMatchObject({ updatedBy: id, snapshot: null });
    } finally {
      await db.appSetting.deleteMany({ where: { key, value: { path: ["updatedBy"], equals: id } } });
      await db.auditLog.deleteMany({ where: { userId: id, entity: "AppSetting", entityId: key, action: { in: ["JOBS_TEAM_DEFAULT_PUBLISHED", "JOBS_TEAM_DEFAULT_REMOVED"] } } });
      await db.$disconnect();
    }
  });
});
