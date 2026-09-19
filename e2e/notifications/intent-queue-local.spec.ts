import { test, expect } from "../fixtures/local-admin";
import { PrismaClient } from "@prisma/client";
test.skip(process.env.SNEEK_E2E_LOCAL_FIXTURES !== "1", "Requires isolated local fixtures");
test.setTimeout(180000);
test("uncertain delivery investigation is audited without sending or blindly retrying", async ({ localAdmin }) => {
  const { id, page } = localAdmin; const db = new PrismaClient(); const intentId = `${id}-intent`;
  try {
    await db.notificationIntent.create({ data: { id: intentId, idempotencyKey: intentId, envelopeHash: "fixture", eventId: intentId, eventKey: "fixture.uncertain", recipientId: id, transport: "EMAIL", status: "UNCERTAIN", attemptCount: 1, nextAttemptAt: null,
      envelope: { version: 1, eventId: intentId, eventKey: "fixture.uncertain", entity: { type: "Fixture", id: intentId }, actorId: id, recipient: { userId: id, role: "ADMIN", scope: { kind: "ADMIN_OPERATIONS" } }, severity: "ACTION", transport: "EMAIL", subject: "Isolated uncertain delivery", body: "No provider send", jobId: null },
      attempts: { create: { number: 1, leaseToken: "fixture", status: "UNCERTAIN", errorCode: "timeout", finishedAt: new Date() } } } });
    await page.goto("/v2/admin/notifications"); await page.getByRole("button", { name: "Delivery queue", exact: true }).click();
    const item = page.getByRole("listitem").filter({ hasText: "Isolated uncertain delivery" }); await expect(item).toBeVisible({ timeout: 30000 });
    await expect(item.getByRole("button", { name: "Retry known rejection" })).toHaveCount(0); await expect(item.getByRole("button", { name: "Reconcile inbox receipt" })).toHaveCount(0);
    await item.getByText("Attempt receipts", { exact: true }).click(); await expect(item.getByText(/No provider reference recorded/)).toBeVisible();
    await item.getByRole("textbox").fill("Checked the provider dashboard; outcome still unknown.");
    await item.getByRole("button", { name: "Record investigation", exact: true }).click();
    await expect.poll(() => db.auditLog.count({ where: { userId: id, entityId: intentId, action: "NOTIFICATION_INTENT_RECORD_INVESTIGATION" } })).toBe(1);
    expect(await db.notificationIntent.findUnique({ where: { id: intentId } })).toMatchObject({ status: "UNCERTAIN", attemptCount: 1 });
    expect(await db.notification.count({ where: { userId: id } })).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  } finally {
    await db.auditLog.deleteMany({ where: { userId: id, entityId: intentId, entity: "NotificationIntent" } });
    await db.notificationAttempt.deleteMany({ where: { intentId } }); await db.notificationIntent.deleteMany({ where: { id: intentId, recipientId: id } }); await db.$disconnect();
  }
});
