/**
 * Bulk client-invoice actions.
 *
 * Each selected invoice goes through the SAME action function the single-row
 * route uses (patchClientInvoice, sendClientInvoice, pushClientInvoiceToXeroOnce),
 * one at a time, so every guard — row lock, started-work review, transition
 * graph, Xero reservation and idempotency key — applies per row exactly as it
 * does for a single click. Each row reports its own outcome; a refused row is
 * never reported as done.
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { patchClientInvoice } from "./client-invoice-patch";
import { sendClientInvoice } from "./client-invoice-send";
import { pushClientInvoiceToXeroOnce } from "./client-invoice-xero";
import { actionError, isActionSuccess, type InvoiceActor } from "./invoice-action-result";
import {
  CLIENT_INVOICE_BULK_ACTIONS,
  CLIENT_INVOICE_BULK_MAX_IDS,
  type ClientInvoiceBulkAction,
  type ClientInvoiceBulkResponse,
  type ClientInvoiceBulkResult,
} from "./client-invoice-list-types";

export const bulkRequestSchema = z.object({
  action: z.enum(CLIENT_INVOICE_BULK_ACTIONS),
  ids: z
    .array(z.string().min(1).max(64))
    .min(1, "Select at least one invoice.")
    .max(CLIENT_INVOICE_BULK_MAX_IDS, `Select at most ${CLIENT_INVOICE_BULK_MAX_IDS} invoices at a time.`),
});
export type BulkRequest = z.infer<typeof bulkRequestSchema>;

type InvoiceSnapshot = { id: string; invoiceNumber: string; status: string };

type RowContext = {
  invoice: InvoiceSnapshot;
  actor: InvoiceActor;
  origin: string;
};

function done(invoice: InvoiceSnapshot): ClientInvoiceBulkResult {
  return { id: invoice.id, invoiceNumber: invoice.invoiceNumber, ok: true, outcome: "done" };
}

function refused(invoice: InvoiceSnapshot, reason: string): ClientInvoiceBulkResult {
  return { id: invoice.id, invoiceNumber: invoice.invoiceNumber, ok: false, outcome: "refused", reason };
}

function unchanged(invoice: InvoiceSnapshot, reason: string): ClientInvoiceBulkResult {
  return { id: invoice.id, invoiceNumber: invoice.invoiceNumber, ok: false, outcome: "unchanged", reason };
}

async function approveRow({ invoice, actor }: RowContext): Promise<ClientInvoiceBulkResult> {
  if (invoice.status === "APPROVED") return unchanged(invoice, "Already approved. Nothing changed.");
  const result = await patchClientInvoice({ invoiceId: invoice.id, body: { status: "APPROVED" }, actor });
  return isActionSuccess(result) ? done(invoice) : refused(invoice, actionError(result, "Approval was refused."));
}

async function sendRow({ invoice, origin }: RowContext): Promise<ClientInvoiceBulkResult> {
  // A bulk send never re-sends: emailing a batch of clients a second copy is
  // what the row's own Re-send action exists to make deliberate.
  if (invoice.status === "SENT" || invoice.status === "PART_PAID") {
    return refused(invoice, "Already sent. Use Re-send on this invoice to email it again.");
  }
  const result = await sendClientInvoice({ invoiceId: invoice.id, origin });
  return isActionSuccess(result) ? done(invoice) : refused(invoice, actionError(result, "Sending was refused."));
}

/** Approve then send, in that order; the send runs only if approval succeeded. */
async function approveAndSendRow(context: RowContext): Promise<ClientInvoiceBulkResult> {
  const { invoice } = context;
  if (invoice.status !== "DRAFT" && invoice.status !== "APPROVED") {
    return refused(invoice, `Only drafts and approved invoices can be approved and sent; this one is ${invoice.status}.`);
  }
  if (invoice.status === "DRAFT") {
    const approval = await approveRow(context);
    if (approval.outcome !== "done") {
      return refused(invoice, `Not approved, so not sent: ${approval.reason ?? "approval was refused."}`);
    }
  }
  const sent = await sendRow({ ...context, invoice: { ...invoice, status: "APPROVED" } });
  if (sent.outcome === "done") return sent;
  const approvedFirst = invoice.status === "DRAFT" ? "Approved, but not sent: " : "";
  return refused(invoice, `${approvedFirst}${sent.reason ?? "sending was refused."}`);
}

async function xeroPushRow({ invoice }: RowContext): Promise<ClientInvoiceBulkResult> {
  const result = await pushClientInvoiceToXeroOnce(invoice.id);
  if (!isActionSuccess(result)) return refused(invoice, actionError(result, "The Xero push was refused."));
  if (result.body.alreadyPushed) return unchanged(invoice, "Already in Xero. Nothing was pushed.");
  return done(invoice);
}

const ROW_HANDLERS: Record<ClientInvoiceBulkAction, (context: RowContext) => Promise<ClientInvoiceBulkResult>> = {
  approve: approveRow,
  send: sendRow,
  "approve-and-send": approveAndSendRow,
  "xero-push": xeroPushRow,
};

export async function runClientInvoiceBulk(input: {
  request: BulkRequest;
  actor: InvoiceActor;
  origin: string;
}): Promise<ClientInvoiceBulkResponse> {
  const ids = Array.from(new Set(input.request.ids));
  const found = await db.clientInvoice.findMany({
    where: { id: { in: ids } },
    select: { id: true, invoiceNumber: true, status: true },
  });
  const byId = new Map(found.map((invoice) => [invoice.id, invoice]));
  const handler = ROW_HANDLERS[input.request.action];
  const results: ClientInvoiceBulkResult[] = [];

  // Sequential on purpose: each row takes its own row lock and provider call,
  // and a later row must see what an earlier one committed.
  for (const id of ids) {
    const invoice = byId.get(id);
    if (!invoice) {
      results.push({ id, invoiceNumber: null, ok: false, outcome: "refused", reason: "Invoice not found." });
      continue;
    }
    try {
      results.push(await handler({ invoice, actor: input.actor, origin: input.origin }));
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message : "The action failed.";
      results.push(refused(invoice, reason));
    }
  }

  const summary = {
    done: results.filter((row) => row.outcome === "done").length,
    refused: results.filter((row) => row.outcome === "refused").length,
    unchanged: results.filter((row) => row.outcome === "unchanged").length,
  };

  // One trail entry for the request as a whole; each row's own action already
  // wrote whatever audit its single-row route writes.
  await db.auditLog
    .create({
      data: {
        userId: input.actor.id,
        action: "CLIENT_INVOICE_BULK_ACTION",
        entity: "ClientInvoice",
        entityId: ids.length === 1 ? ids[0] : "bulk",
        after: {
          action: input.request.action,
          summary,
          results: results.map(({ id, invoiceNumber, outcome, reason }) => ({ id, invoiceNumber, outcome, reason: reason ?? null })),
        } as object,
      },
    })
    .catch((error) => logger.error({ error }, "[invoice] bulk action completed but its audit entry could not be written"));

  return { action: input.request.action, results, summary };
}
