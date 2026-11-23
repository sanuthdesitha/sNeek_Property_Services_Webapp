/**
 * "Update in Xero" (2026-11-18): re-send an already-pushed client invoice's or
 * credit note's current lines, in the PDF's order, to the SAME Xero document.
 *
 * What it can change in Xero: the order of lines (property grouping) and any
 * line text this app holds. It cannot change an amount here: once an invoice
 * is in Xero, the app refuses every content edit except reordering
 * (client-invoice-patch.ts), so the lines sent carry the amounts already
 * issued. If Xero's total or line amounts differ from this invoice's (someone
 * changed it in Xero), nothing is sent until the person confirms the exact two
 * totals shown; a paid, part-paid, credited, voided or deleted Xero document
 * is refused outright.
 *
 * Never creates a document: it POSTs to the stored Xero id only, and success is
 * recorded only when Xero answers with that same id. A failure is recorded on
 * the invoice (metadata.xeroUpdate) and in History; the invoice stays pushed.
 */
import { ClientInvoiceStatus, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { readXeroCreditNote, readXeroInvoice, updateClientDocumentInXero } from "@/lib/xero/client";
import type { XeroDocument } from "@/lib/xero/xero-documents";
import { getPhase3IntegrationsSettings } from "@/lib/phase3/integrations";
import { recordInvoiceAudit } from "./client-invoice-audit";
import { XERO_ACCOUNT_NOT_SET, XERO_PUSH_LINES_INCLUDE } from "./client-invoice-xero";
import { resolveClientInvoiceAccounts } from "@/lib/xero/client-invoice-accounts";
import { buildXeroLineItems, type XeroLineItem } from "./client-invoice-xero-lines";
import { xeroCreditNoteLineItem } from "./client-invoice-xero-mapping";
import { recordXeroUpdateFailure, sanitiseXeroFailureReason } from "./client-invoice-xero-failure";
import {
  XERO_LINE_CHANGE_LABEL,
  XERO_UPDATE_IN_FLIGHT_REFUSAL,
  compareXeroLines,
  needsOverwriteConfirmation,
  readStoredXeroUpdate,
  xeroUpdateEligibility,
  xeroUpdateInFlight,
  type XeroLineChange,
  type XeroTotalsConfirmation,
} from "./client-invoice-xero-update-rules";
import { actionResult, type InvoiceActionResult, type InvoiceActor } from "./invoice-action-result";

/** Refusal code when the person must confirm overwriting Xero's figures. */
export const XERO_UPDATE_NEEDS_CONFIRMATION = "XERO_UPDATE_NEEDS_CONFIRMATION";

export type XeroUpdateInput = {
  invoiceId: string;
  actor: InvoiceActor;
  /** One per confirmation dialog: a double-click or a retry repeats it. */
  requestKey: string;
  /** Present only after the person confirmed the two differing totals. */
  confirmTotals?: XeroTotalsConfirmation | null;
};

/** The body of a successful update. */
export type XeroUpdateSuccess = {
  ok: true;
  xeroInvoiceId: string;
  change: XeroLineChange;
  message: string;
  repeated?: boolean;
};

type MetadataObject = Record<string, unknown>;

function metadataOf(value: unknown): MetadataObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as MetadataObject) : {};
}

function money(value: number): string {
  return `$${Math.abs(value).toFixed(2)}`;
}

async function readDocument(kind: "ACCREC" | "ACCRECCREDIT", xeroId: string) {
  return kind === "ACCRECCREDIT" ? readXeroCreditNote(xeroId) : readXeroInvoice(xeroId);
}

/** The lines as Xero receives them: a credit note's stored negative amounts become positive. */
function outgoingLines(items: XeroLineItem[], creditNote: boolean): XeroLineItem[] {
  return creditNote ? items.map(xeroCreditNoteLineItem) : items;
}

export async function updateClientInvoiceInXero(input: XeroUpdateInput): Promise<InvoiceActionResult> {
  const { invoiceId, actor, requestKey } = input;
  // Same rule as the other money corrections: the person at the keyboard acts
  // as themselves, never while viewing as someone else.
  if (actor.impersonatedBy) return actionResult({ error: "FORBIDDEN" }, 403);

  const [invoice, integrations] = await Promise.all([
    db.clientInvoice.findUnique({ where: { id: invoiceId }, include: { lines: XERO_PUSH_LINES_INCLUDE } }),
    getPhase3IntegrationsSettings(),
  ]);
  if (!invoice) return actionResult({ error: "Invoice not found." }, 404);
  if (invoice.status === ClientInvoiceStatus.VOID) {
    return actionResult({ error: "This invoice is void here, so it is not updated in Xero." }, 409);
  }
  if (!invoice.xeroInvoiceId) return actionResult({ error: "This invoice is not in Xero yet. Push it to Xero first." }, 409);
  if (invoice.lines.length === 0) return actionResult({ error: "This invoice has no lines, so there is nothing to send to Xero." }, 409);

  const stored = readStoredXeroUpdate(invoice.metadata);
  if (stored && stored.key === requestKey && stored.state === "DONE") {
    // A double-click or a retry after a lost answer: already done, nothing is sent again.
    return actionResult<XeroUpdateSuccess>({
      ok: true,
      repeated: true,
      xeroInvoiceId: invoice.xeroInvoiceId,
      change: stored.change ?? "unknown",
      message: "Already updated in Xero. Nothing was sent again.",
    });
  }
  if (xeroUpdateInFlight(invoice.metadata)) return actionResult({ error: XERO_UPDATE_IN_FLIGHT_REFUSAL }, 409);

  const creditNote = invoice.kind === "CREDIT_NOTE";
  const kind = creditNote ? "ACCRECCREDIT" : "ACCREC";
  const xeroId = invoice.xeroInvoiceId;

  // No sales account chosen: refused before Xero is read or anything is
  // reserved, exactly as the push is (2026-11-23, was "200").
  const accounts = resolveClientInvoiceAccounts(integrations.xero);
  if (!accounts.ok) return actionResult({ error: accounts.reason, code: XERO_ACCOUNT_NOT_SET }, 409);

  // Built before anything is read or reserved: a missing disbursement account
  // refuses here, exactly as the push does.
  let lineItems: XeroLineItem[];
  try {
    const taxType = invoice.gstEnabled === false ? "NONE" : integrations.xero.salesTaxType?.trim() || undefined;
    lineItems = outgoingLines(buildXeroLineItems(invoice.lines, integrations.xero, taxType, { creditNote }), creditNote);
  } catch (error) {
    return actionResult({ error: error instanceof Error ? error.message : "The lines could not be prepared for Xero." }, 400);
  }

  // The document's state in Xero NOW, not as last synced.
  const read = await readDocument(kind, xeroId);
  if (!read.ok) {
    return actionResult({ error: `Xero could not be read, so nothing was sent: ${read.failure.reason}` }, read.failure.kind === "not-connected" ? 409 : 502);
  }
  const document: XeroDocument = read.document;
  const eligibility = xeroUpdateEligibility(document);
  if (!eligibility.ok) return actionResult({ error: `${eligibility.reason} Nothing was changed.` }, 409);

  const localTotal = Math.abs(Number(invoice.totalAmount ?? 0));
  const xeroTotal = Math.abs(document.total);
  const change = compareXeroLines(document.lineItems, lineItems);
  if (needsOverwriteConfirmation({ localTotal, xeroTotal, change, confirmed: input.confirmTotals })) {
    return actionResult(
      {
        error: `Xero's figures differ from this invoice. Xero total ${money(xeroTotal)}; this invoice ${money(localTotal)}. Updating replaces Xero's lines with this invoice's lines.`,
        code: XERO_UPDATE_NEEDS_CONFIRMATION,
        localTotal,
        xeroTotal,
        change,
      },
      409,
    );
  }
  const totalsDiffered = Math.round(localTotal * 100) !== Math.round(xeroTotal * 100);

  // Reserve under the same row lock as every invoice edit: the lines read
  // above must still be the lines (no reorder, no other update meanwhile).
  const now = new Date();
  const reservation = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ClientInvoice" WHERE "id" = ${invoice.id} FOR UPDATE`;
    const current = await tx.clientInvoice.findUnique({ where: { id: invoice.id }, select: { status: true, xeroInvoiceId: true, updatedAt: true, metadata: true } });
    if (!current || current.status === ClientInvoiceStatus.VOID || current.xeroInvoiceId !== xeroId) return "changed" as const;
    if (xeroUpdateInFlight(current.metadata, now)) return "in-flight" as const;
    if (current.updatedAt.getTime() !== invoice.updatedAt.getTime()) return "changed" as const;
    const metadata = metadataOf(current.metadata);
    const previous = readStoredXeroUpdate(metadata);
    await tx.clientInvoice.update({
      where: { id: invoice.id },
      data: {
        metadata: {
          ...metadata,
          xeroUpdate: {
            state: "PENDING",
            key: requestKey,
            at: now.toISOString(),
            reason: null,
            lastSuccessAt: previous?.lastSuccessAt ?? null,
            change,
            xeroStatusBefore: document.status,
          },
        } as Prisma.InputJsonObject,
      },
    });
    return "reserved" as const;
  });
  if (reservation === "in-flight") return actionResult({ error: XERO_UPDATE_IN_FLIGHT_REFUSAL }, 409);
  if (reservation === "changed") return actionResult({ error: "This invoice changed while Xero was being checked. Reload it and try again. Nothing was sent." }, 409);

  const auditBase = {
    xeroInvoiceId: xeroId,
    kind,
    change,
    xeroStatusBefore: document.status,
    localTotal,
    xeroTotalBefore: xeroTotal,
    totalsDiffered,
    confirmedDifference: totalsDiffered || change === "amounts",
    lineCount: lineItems.length,
  };

  try {
    const updated = await updateClientDocumentInXero({
      kind,
      xeroId,
      // One provider key per attempt: a retry of the same attempt cannot apply twice.
      idempotencyKey: `client-${creditNote ? "credit-note" : "invoice"}-update-${invoice.id}-${requestKey}`,
      lineItems,
      gstEnabled: invoice.gstEnabled,
    });
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ClientInvoice" WHERE "id" = ${invoice.id} FOR UPDATE`;
      const current = await tx.clientInvoice.findUnique({ where: { id: invoice.id }, select: { metadata: true } });
      const metadata = metadataOf(current?.metadata);
      const doneAt = new Date().toISOString();
      await tx.clientInvoice.update({
        where: { id: invoice.id },
        data: {
          metadata: {
            ...metadata,
            xeroUpdate: { state: "DONE", key: requestKey, at: doneAt, reason: null, lastSuccessAt: doneAt, change, xeroStatusBefore: document.status },
          } as Prisma.InputJsonObject,
        },
      });
    });
    await recordInvoiceAudit({
      actorId: actor.id,
      invoiceId: invoice.id,
      action: "CLIENT_INVOICE_XERO_UPDATE",
      after: { outcome: "updated", ...auditBase, xeroStatusAfter: updated.status, xeroTotalAfter: updated.total },
    });
    return actionResult<XeroUpdateSuccess>({
      ok: true,
      xeroInvoiceId: xeroId,
      change,
      message: change === "none" ? "Updated in Xero. Xero already listed these lines in this order." : `Updated in Xero (${XERO_LINE_CHANGE_LABEL[change]}).`,
    });
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "Could not update the invoice in Xero.";
    await recordXeroUpdateFailure(invoice.id, requestKey, message);
    await recordInvoiceAudit({
      actorId: actor.id,
      invoiceId: invoice.id,
      action: "CLIENT_INVOICE_XERO_UPDATE",
      after: { outcome: "failed", ...auditBase, error: sanitiseXeroFailureReason(message) },
    });
    return actionResult({ error: `Xero refused the update: ${sanitiseXeroFailureReason(message)} Nothing was changed here.` }, 502);
  }
}
