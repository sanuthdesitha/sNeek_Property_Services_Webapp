import { db } from "@/lib/db";
import { reconcileLowStockShoppingRun, type LowStockRow } from "@/lib/inventory/stock";
import { queueDelivery } from "@/lib/notifications/queue-delivery";
import { loadNotificationWording } from "@/lib/notifications/wording/render";

type Input = { jobId: string; submissionId: string; propertyId: string; lowStockRows: LowStockRow[] };
/** Internal reconciliation and delivery intents commit together. Provider uncertainty is handled by the outbox. */
export async function reconcileSubmissionLowStock(input: Input) {
  const wording = await loadNotificationWording("stock.submission_low_stock");
  return db.$transaction(async tx => {
    const key = `submission_low_stock_done_v1:${input.submissionId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    if (await tx.appSetting.findUnique({ where: { key } })) return;
    const result = await reconcileLowStockShoppingRun(tx, input.propertyId, input.lowStockRows);
    const recipients = await tx.user.findMany({ where: { role: { in: ["ADMIN", "OPS_MANAGER"] }, isActive: true }, select: { id: true, role: true } });
    if (!recipients.length) throw new Error("LOW_STOCK_NO_OFFICE_RECIPIENT");
    for (const row of input.lowStockRows) {
      const alert = wording.render("low-stock", "INBOX", { itemName: row.itemName, onHand: row.onHand });
      await queueDelivery({ recipients, category: "shopping", jobId: input.jobId, url: "/admin/shopping-runs", web: { subject: alert.title, body: alert.body } }, {
        tx, eventId: input.submissionId, eventKey: "submission.low_stock", entity: { type: "PropertyStock", id: row.stockId }, actorId: null, severity: "ACTION", scope: { kind: "ADMIN_OPERATIONS" }, transports: ["INBOX", "WEB_PUSH"],
      });
    }
    if (result.createdNew) {
      const values = { count: input.lowStockRows.length };
      const { title: subject, body } = wording.render("auto-run", "INBOX", values);
      const email = wording.render("auto-run", "EMAIL", values);
      await queueDelivery({ recipients, category: "shopping", jobId: input.jobId, url: "/admin/shopping-runs", web: { subject, body }, email: { subject: email.subject, html: email.html, logBody: body } }, {
        tx, eventId: input.submissionId, eventKey: "submission.shopping_run", entity: { type: "ShoppingRun", id: result.runId }, actorId: null, severity: "ACTION", scope: { kind: "ADMIN_OPERATIONS" },
      });
    }
    await tx.appSetting.create({ data: { key, value: { submissionId: input.submissionId, shoppingRunId: result.runId, status: "DONE" } } });
  });
}

/** Surface a persisted reconciliation failure to office; this enqueues only, never sends. */
export async function queueLowStockReview(input: { jobId: string; submissionId: string }) {
  const text = (await loadNotificationWording("stock.submission_low_stock")).render("restock-review", "INBOX", {});
  await db.$transaction(async tx => {
    const recipients = await tx.user.findMany({ where: { role: { in: ["ADMIN", "OPS_MANAGER"] }, isActive: true }, select: { id: true, role: true } });
    await queueDelivery({ recipients, category: "shopping", jobId: input.jobId, web: { subject: text.title, body: text.body } }, {
      tx, eventId: input.submissionId, eventKey: "submission.low_stock_review", entity: { type: "FormSubmission", id: input.submissionId }, actorId: null, severity: "ACTION", scope: { kind: "ADMIN_OPERATIONS" }, transports: ["INBOX"],
    });
  });
}
