import { db } from "@/lib/db";
import { reconcileLowStockShoppingRun, type LowStockRow } from "@/lib/inventory/stock";
import { queueDelivery } from "@/lib/notifications/queue-delivery";

type Input = { jobId: string; submissionId: string; propertyId: string; lowStockRows: LowStockRow[] };
/** Internal reconciliation and delivery intents commit together. Provider uncertainty is handled by the outbox. */
export async function reconcileSubmissionLowStock(input: Input) {
  return db.$transaction(async tx => {
    const key = `submission_low_stock_done_v1:${input.submissionId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    if (await tx.appSetting.findUnique({ where: { key } })) return;
    const result = await reconcileLowStockShoppingRun(tx, input.propertyId, input.lowStockRows);
    const recipients = await tx.user.findMany({ where: { role: { in: ["ADMIN", "OPS_MANAGER"] }, isActive: true }, select: { id: true, role: true } });
    if (!recipients.length) throw new Error("LOW_STOCK_NO_OFFICE_RECIPIENT");
    for (const row of input.lowStockRows) {
      await queueDelivery({ recipients, category: "shopping", jobId: input.jobId, url: "/admin/shopping-runs", web: { subject: "Low stock alert", body: `${row.itemName} is low at this property (${row.onHand} remaining).` } }, {
        tx, eventId: input.submissionId, eventKey: "submission.low_stock", entity: { type: "PropertyStock", id: row.stockId }, actorId: null, severity: "ACTION", scope: { kind: "ADMIN_OPERATIONS" }, transports: ["INBOX", "WEB_PUSH"],
      });
    }
    if (result.createdNew) {
      const subject = "Auto shopping run created";
      const body = `${input.lowStockRows.length} low-stock items were added to an automatically created shopping run.`;
      await queueDelivery({ recipients, category: "shopping", jobId: input.jobId, url: "/admin/shopping-runs", web: { subject, body }, email: { subject, html: `<p>${body}</p>`, logBody: body } }, {
        tx, eventId: input.submissionId, eventKey: "submission.shopping_run", entity: { type: "ShoppingRun", id: result.runId }, actorId: null, severity: "ACTION", scope: { kind: "ADMIN_OPERATIONS" },
      });
    }
    await tx.appSetting.create({ data: { key, value: { submissionId: input.submissionId, shoppingRunId: result.runId, status: "DONE" } } });
  });
}

/** Surface a persisted reconciliation failure to office; this enqueues only, never sends. */
export async function queueLowStockReview(input: { jobId: string; submissionId: string }) {
  await db.$transaction(async tx => {
    const recipients = await tx.user.findMany({ where: { role: { in: ["ADMIN", "OPS_MANAGER"] }, isActive: true }, select: { id: true, role: true } });
    await queueDelivery({ recipients, category: "shopping", jobId: input.jobId, web: { subject: "Submission restock needs review", body: "Restock follow-up could not finish. The submission is saved; office should check its stock and shopping run. Internal reconciliation will retry." } }, {
      tx, eventId: input.submissionId, eventKey: "submission.low_stock_review", entity: { type: "FormSubmission", id: input.submissionId }, actorId: null, severity: "ACTION", scope: { kind: "ADMIN_OPERATIONS" }, transports: ["INBOX"],
    });
  });
}
