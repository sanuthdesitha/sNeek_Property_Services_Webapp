import { test, expect } from "../fixtures/local-admin";
import { PrismaClient } from "@prisma/client";

test.skip(process.env.SNEEK_E2E_LOCAL_FIXTURES !== "1", "Requires isolated loopback fixture");
test.setTimeout(180000);
test("snooze persists across reload and expires without a notification or state write", async ({ localAdmin }) => {
  const { page, id } = localAdmin; const db = new PrismaClient(); const noteId = `${id}-snooze`;
  const key = `notification_inbox_v1:${encodeURIComponent(id)}:${encodeURIComponent(noteId)}`;
  try {
    await db.notification.create({ data: { id: noteId, userId: id, channel: "PUSH", subject: "Snooze fixture", body: "No outbound delivery", status: "FAILED", deliveryStatus: "PENDING" } });
    await page.goto("/v2/admin/jobs");
    await page.getByRole("button", { name: "Recent notifications", exact: true }).click();
    const item = page.getByRole("listitem").filter({ hasText: "Snooze fixture" });
    await item.getByText("Delivery details", { exact: true }).click();
    await expect(item.getByText("Dispatch failed", { exact: true })).toBeVisible();
    await expect(item.getByText("No provider delivery evidence recorded", { exact: true })).toBeVisible();
    await expect(item.getByText(/Acknowledgement: not recorded/)).toBeVisible();
    await item.getByRole("button", { name: "Snooze 1 hour", exact: true }).click(); await expect(item).toHaveCount(0);
    await page.reload(); await page.getByRole("button", { name: "Recent notifications", exact: true }).click(); await expect(item).toHaveCount(0);
    await page.getByLabel("Personal follow-up filter").selectOption("SNOOZED"); await expect(item).toBeVisible();
    await item.getByRole("button", { name: "End snooze", exact: true }).click(); await expect(item).toHaveCount(0);
    const stored = await db.appSetting.findUniqueOrThrow({ where: { key } });
    const response = await page.request.patch("/api/notifications/inbox-state", { data: { id: noteId, revision: (stored.value as any).revision, action: "SNOOZE", snoozedUntil: new Date(Date.now() + 4000).toISOString() } }); expect(response.ok()).toBe(true);
    const saved = await db.appSetting.findUniqueOrThrow({ where: { key } });
    const auditCount = await db.auditLog.count({ where: { userId: id, entityId: noteId } });
    await page.getByRole("button", { name: "Refresh notifications", exact: true }).click(); await expect(item).toBeVisible();
    await expect(item).toHaveCount(0, { timeout: 12000 });
    await page.getByLabel("Personal follow-up filter").selectOption("ACTIVE"); await expect(item).toBeVisible();
    expect((await db.appSetting.findUniqueOrThrow({ where: { key } })).value).toEqual(saved.value);
    expect(await db.auditLog.count({ where: { userId: id, entityId: noteId } })).toBe(auditCount);
    await item.getByRole("button", { name: "Acknowledge notification", exact: true }).click();
    await expect(item.getByText(/^Acknowledged /)).toBeVisible();
    await page.reload(); await page.getByRole("button", { name: "Recent notifications", exact: true }).click();
    await expect(item.getByText(/^Acknowledged /)).toBeVisible();
    await expect(item.getByText("Unread", { exact: true })).toBeVisible();
    expect(await db.notification.findUnique({ where: { id: noteId } })).toMatchObject({ status: "FAILED", deliveryStatus: "PENDING" });
  } finally {
    await db.auditLog.deleteMany({ where: { userId: id, entityId: noteId, entity: "Notification" } });
    await db.appSetting.deleteMany({ where: { key } });
    await db.notification.deleteMany({ where: { id: noteId, userId: id } });
    await db.$disconnect();
  }
});
