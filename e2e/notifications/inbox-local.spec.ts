import { test, expect } from "../fixtures/local-admin";
import { PrismaClient } from "@prisma/client";
import type { Page } from "@playwright/test";

class NotificationInboxPage {
  constructor(private page: Page) {}
  async open() { await this.page.getByRole("button", { name: "Recent notifications", exact: true }).click(); }
  async settings() { await this.page.getByRole("button", { name: "Notification settings and device", exact: true }).click(); }
  async markRead(subject: string) { await this.page.getByRole("listitem").filter({ hasText: subject }).getByRole("button", { name: "Mark as read", exact: true }).click(); }
  async close() { await this.page.getByRole("button", { name: "Close notifications", exact: true }).click(); }
}

test.describe("notification inbox on an isolated account", () => {
  test.skip(process.env.SNEEK_E2E_LOCAL_FIXTURES !== "1", "Requires explicitly enabled loopback database fixtures");
  test.setTimeout(180_000);
  test("persists explicit read status and keeps email provider records unchanged", async ({ localAdmin }) => {
    const { page, id } = localAdmin;
    const db = new PrismaClient();
    const pushId = `${id}-inbox-push`;
    const emailId = `${id}-provider-email`;
    const subject = `Inbox verification ${id}`;
    try {
      await db.notification.createMany({ data: [
        { id: pushId, userId: id, channel: "PUSH", subject, body: "Synthetic browser fixture, no outbound delivery.", status: "SENT" },
        { id: emailId, userId: id, channel: "EMAIL", subject: "Private provider test record", body: "No email was sent.", status: "SENT", deliveryStatus: "DELIVERED" },
      ] });
      await page.goto("/v2/admin/jobs");
      const inbox = new NotificationInboxPage(page);
      await inbox.open();
      await expect(page.getByRole("link").filter({ hasText: subject })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("Private provider test record", { exact: true })).toHaveCount(0);
      await inbox.markRead(subject);
      await expect(page.getByRole("listitem").filter({ hasText: subject }).getByText("Read", { exact: true })).toBeVisible();
      await expect.poll(async () => (await db.notification.findUnique({ where: { id: pushId } }))?.deliveryStatus).toBe("OPENED");
      await inbox.close(); await page.reload(); await inbox.open();
      await expect(page.getByRole("listitem").filter({ hasText: subject }).getByText("Read", { exact: true })).toBeVisible();
      await page.getByRole("checkbox", { name: "Unread only (loaded history)" }).check();
      await expect(page.getByRole("link").filter({ hasText: subject })).toHaveCount(0);
      await page.getByRole("checkbox", { name: "Unread only (loaded history)" }).uncheck();
      const item = page.getByRole("listitem").filter({ hasText: subject });
      await item.getByRole("button", { name: "Needs action", exact: true }).click();
      await item.getByRole("button", { name: "Resolve follow-up", exact: true }).click();
      await expect(item.getByText("Personal follow-up: Resolved", { exact: true })).toBeVisible();
      await item.getByRole("button", { name: "Archive", exact: true }).click();
      await expect(item).toHaveCount(0);
      await inbox.close(); await page.reload(); await inbox.open();
      await expect(page.getByRole("link").filter({ hasText: subject })).toHaveCount(0);
      await page.getByLabel("Personal follow-up filter").selectOption("ARCHIVED");
      await expect(item.getByText("Personal follow-up: Resolved · Archived", { exact: true })).toBeVisible();
      await item.getByRole("button", { name: "Restore to inbox", exact: true }).click();
      await expect(item).toHaveCount(0);
      await page.getByLabel("Personal follow-up filter").selectOption("RESOLVED");
      await expect(item).toBeVisible();
      expect((await db.notification.findUnique({ where: { id: pushId } }))?.deliveryStatus).toBe("OPENED");
      expect((await db.notification.findUnique({ where: { id: emailId } }))?.deliveryStatus).toBe("DELIVERED");
    } finally {
      await db.appSetting.deleteMany({ where: { key: `notification_inbox_v1:${encodeURIComponent(id)}:${encodeURIComponent(pushId)}` } });
      await db.auditLog.deleteMany({ where: { userId: id, entity: "Notification", entityId: pushId, action: { startsWith: "NOTIFICATION_INBOX_" } } });
      await db.notification.deleteMany({ where: { userId: id, id: { in: [pushId, emailId] } } });
      await db.$disconnect();
    }
  });
  test("device inspection does not request permission or dispatch notifications", async ({ localAdmin }) => {
    const { page } = localAdmin;
    const mutations: string[] = [];
    page.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (["/api/push/subscribe", "/api/push/unsubscribe", "/api/push/test"].includes(path)) mutations.push(path);
    });
    const permission = await page.evaluate(() => typeof Notification === "undefined" ? "unavailable" : Notification.permission);
    await page.goto("/v2/admin/jobs");
    const inbox = new NotificationInboxPage(page); await inbox.open(); await inbox.settings();
    await expect(page.getByText("Browser permission", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Registered to this account", { exact: true })).toBeVisible();
    await expect(page.getByText(/do not configure a digest schedule/)).toBeVisible();
    expect(await page.evaluate(() => typeof Notification === "undefined" ? "unavailable" : Notification.permission)).toBe(permission);
    expect(mutations).toEqual([]);
  });
  test("failed inbox refresh exposes retry rather than false empty history", async ({ localAdmin }) => {
    const { page } = localAdmin;
    await page.route("**/api/notifications/log?*", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable" }) }));
    await page.goto("/v2/admin/jobs"); await new NotificationInboxPage(page).open();
    await expect(page.getByRole("alert")).toContainText("Could not refresh notifications");
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await expect(page.getByText("No recent notifications.", { exact: true })).toHaveCount(0);
  });
});
