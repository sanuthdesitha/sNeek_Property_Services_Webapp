/**
 * Bulk approve and bulk push to Xero for payee invoices. Each selected invoice
 * goes through the same single-row action, one at a time, and reports its own
 * outcome; a refused row is never reported as done.
 */
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { applyCleanerInvoiceStatus, cleanerActionError, pushCleanerInvoiceOnce, type CleanerActionResult, type CleanerInvoiceActor } from "./invoice-admin-actions";
import type { CleanerBulkResponse, CleanerBulkResult, CleanerInvoiceBulkAction } from "./invoice-admin-list-types";

async function runRow(action: CleanerInvoiceBulkAction, id: string, actor: CleanerInvoiceActor): Promise<CleanerActionResult> {
  try {
    if (action === "approve") return await applyCleanerInvoiceStatus({ id, body: { status: "APPROVED" }, actor });
    return await pushCleanerInvoiceOnce(id, actor);
  } catch (err) {
    return cleanerActionError(err, action === "approve" ? "Approval failed." : "Xero push failed.");
  }
}

export async function runCleanerInvoiceBulk(input: { action: CleanerInvoiceBulkAction; ids: string[]; actor: CleanerInvoiceActor }): Promise<CleanerBulkResponse> {
  const found = await db.cleanerInvoiceSubmission.findMany({ where: { id: { in: input.ids } }, select: { id: true, invoiceNumber: true, status: true, xeroBillId: true } });
  const byId = new Map(found.map((row) => [row.id, row]));
  const results: CleanerBulkResult[] = [];
  for (const id of input.ids) {
    const row = byId.get(id);
    if (!row) {
      results.push({ id, invoiceNumber: null, outcome: "refused", reason: "Invoice not found." });
      continue;
    }
    if (input.action === "approve" && row.status === "APPROVED") {
      results.push({ id, invoiceNumber: row.invoiceNumber, outcome: "unchanged", reason: "Already approved." });
      continue;
    }
    if (input.action === "xero-push" && row.xeroBillId) {
      results.push({ id, invoiceNumber: row.invoiceNumber, outcome: "unchanged", reason: "Already in Xero." });
      continue;
    }
    const outcome = await runRow(input.action, id, input.actor);
    const error = typeof outcome.body.error === "string" ? outcome.body.error : null;
    results.push(outcome.status < 400
      ? { id, invoiceNumber: row.invoiceNumber, outcome: "done" }
      : { id, invoiceNumber: row.invoiceNumber, outcome: "refused", reason: error ?? "Refused." });
  }
  const summary = { done: 0, refused: 0, unchanged: 0 };
  for (const result of results) summary[result.outcome] += 1;
  await db.auditLog
    .create({ data: { userId: input.actor.id, action: "CLEANER_INVOICE_BULK_ACTION", entity: "CleanerInvoiceSubmission", entityId: "bulk", after: { action: input.action, summary, ids: input.ids } } })
    .catch((error) => logger.error({ error }, "[cleaner-invoice] bulk action done but its audit entry could not be written"));
  return { action: input.action, results, summary };
}
