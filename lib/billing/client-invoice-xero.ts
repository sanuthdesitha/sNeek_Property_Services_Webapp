/**
 * Push one client invoice to Xero exactly once — moved verbatim out of
 * `app/api/admin/invoices/[id]/xero-push/route.ts` so the single action and the
 * bulk route share the VOID refusal, the already-pushed idempotency answer, the
 * durable PENDING reservation under the row lock, the started-work review and
 * the provider idempotency key. Push semantics are unchanged.
 */
import { isShoppingDisbursement, shoppingXeroMapping } from "@/lib/finance/shopping-accounting";
import { ClientInvoiceStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { assertStartedWorkReviewed } from "@/lib/billing/started-work-reconciliation";
import { pushClientCreditNoteToXero, pushClientInvoiceToXero } from "@/lib/xero/client";
import { emptyInvoiceRefusal } from "./client-invoice-guards";
import { recordInvoiceAudit } from "./client-invoice-audit";
import { xeroCreditNoteLineItem, xeroInvoiceReference } from "./client-invoice-xero-mapping";
import { getPhase3IntegrationsSettings } from "@/lib/phase3/integrations";
import { actionResult, type InvoiceActionResult } from "./invoice-action-result";

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Push once, and record who asked and what happened in the invoice's History. */
export async function pushClientInvoiceToXeroOnce(invoiceId: string, actorId?: string | null): Promise<InvoiceActionResult> {
  const result = await pushOnce(invoiceId);
  const body = result.body as { alreadyPushed?: boolean; xeroInvoiceId?: string; error?: string };
  const outcome = result.status >= 400 ? "failed" : body.alreadyPushed ? "already-pushed" : "pushed";
  if (result.status !== 404) {
    await recordInvoiceAudit({
      actorId,
      invoiceId,
      action: "CLIENT_INVOICE_XERO_PUSH",
      after: { outcome, xeroInvoiceId: body.xeroInvoiceId ?? null, ...(outcome === "failed" ? { error: body.error ?? null } : {}) },
    });
  }
  return result;
}

async function pushOnce(invoiceId: string): Promise<InvoiceActionResult> {
  try {
    const [invoice, integrations] = await Promise.all([
      db.clientInvoice.findUnique({
        where: { id: invoiceId },
        include: {
          client: true,
          lines: {
            include: {
              job: {
                select: {
                  jobType: true,
                  jobNumber: true,
                },
              },
            },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
          creditsInvoice: { select: { invoiceNumber: true } },
        },
      }),
      getPhase3IntegrationsSettings(),
    ]);

    if (!invoice) return actionResult({ error: "Invoice not found." }, 404);

    // A void invoice is cancelled, and this route CREATES a real invoice in
    // Xero. Pushing one puts a live receivable in the accounts for money nobody
    // owes, and the only way back is a manual credit note — after which the
    // books and this system disagree about the client's balance, and the books
    // win. Far cheaper to refuse than to unpick.
    if (invoice.status === ClientInvoiceStatus.VOID) {
      return actionResult(
        { error: "This invoice is void. Push the replacement instead." }, 409);
    }

    // Idempotency: pushClientInvoiceToXero CREATES a new Xero invoice, so a
    // second push (double-click, retry) would duplicate it. Refuse to re-push an
    // already-exported invoice; retries must never bypass that protection.
    if (invoice.xeroInvoiceId) {
      return actionResult({
        ok: true,
        alreadyPushed: true,
        xeroInvoiceId: invoice.xeroInvoiceId,
        message: "This invoice was already pushed to Xero.",
      });
    }
    const empty = emptyInvoiceRefusal(invoice);
    if (empty) return actionResult({ error: empty }, 409);
    const creditNote = invoice.kind === "CREDIT_NOTE";
    // A credit note goes to Xero once it is issued (approved or sent), never
    // as a draft whose amount may still change.
    if (creditNote && invoice.status !== ClientInvoiceStatus.APPROVED && invoice.status !== ClientInvoiceStatus.SENT) {
      return actionResult({ error: "Approve or send this credit note before pushing it to Xero." }, 409);
    }

    const defaultItemCode = integrations.xero.defaultItemCode?.trim() || "";
    const itemCodeByService = integrations.xero.itemCodeByService ?? {};
    // Per line: prefer the item code mapped to that job's service type, else the
    // default item code, else none.
    const itemCodeFor = (line: (typeof invoice.lines)[number]) => {
      const svc = line.job?.jobType ? itemCodeByService[line.job.jobType]?.trim() : "";
      return svc || defaultItemCode || undefined;
    };
    // Only send an explicit tax type when configured (e.g. AU "OUTPUT2"); leaving
    // it undefined lets Xero apply the sales account's own default tax rate,
    // which avoids region-specific "invalid TaxType" 400s.
    const taxType = invoice.gstEnabled === false ? "NONE" : integrations.xero.salesTaxType?.trim() || undefined;
    const reference = xeroInvoiceReference({
      clientReference: invoice.clientReference,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      creditsInvoiceNumber: invoice.creditsInvoice?.invoiceNumber ?? null,
    });

    // The stored line.description already reads "Property - Service - date"; just
    // append the job number (and any per-job note) — no duplicate property/date.
    const buildDescription = (line: (typeof invoice.lines)[number]) => {
      let desc = line.description;
      if (line.job?.jobNumber) desc += ` · Job ${line.job.jobNumber}`;
      if (line.note) desc += ` — ${line.note}`;
      return desc;
    };

    const lineItems = invoice.lines.map((line) => ({
        description: buildDescription(line),
        quantity: line.quantity,
        unitAmount: line.unitPrice,
        ...shoppingXeroMapping(line.category, integrations.xero, taxType),
        itemCode: isShoppingDisbursement(line.category) ? undefined : itemCodeFor(line),
      }));
    // Reserve a durable export intent under the same row lock as invoice edits.
    // Failures leave PENDING; retry reuses the document's provider key.
    const reserved = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "ClientInvoice" WHERE "id" = ${invoice.id} FOR UPDATE`;
      const current = await tx.clientInvoice.findUnique({ where: { id: invoice.id } });
      if (!current || current.status === ClientInvoiceStatus.VOID) throw new Error("Invoice is no longer exportable.");
      await assertStartedWorkReviewed({ ...invoice, metadata: current.metadata }, tx);
      if (current.xeroInvoiceId) return current.xeroInvoiceId;
      if (current.updatedAt?.getTime() !== invoice.updatedAt?.getTime()) throw new Error("Invoice changed before export. Refresh and retry.");
      const metadata = current.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata) ? current.metadata : {};
      await tx.clientInvoice.update({ where: { id: current.id }, data: { metadata: { ...metadata, xeroExportState: "PENDING" } } });
      return null;
    });
    if (reserved) return actionResult({ ok: true, alreadyPushed: true, xeroInvoiceId: reserved });

    const contact = {
      clientName: invoice.client.name || "Unknown Client",
      clientEmail: invoice.client.email || integrations.xero.contactFallbackEmail || "no-reply@sneekops.com.au",
      clientXeroContactId: invoice.client.xeroContactId ?? undefined,
    };
    // A credit note becomes a Xero credit note (ACCRECCREDIT) with positive
    // amounts; its id is kept in xeroInvoiceId like an invoice's. The
    // invoice's idempotency key is unchanged ("client-invoice-<id>").
    const result = creditNote
      ? await pushClientCreditNoteToXero({
          idempotencyKey: `client-credit-note-${invoice.id}`,
          creditNoteNumber: invoice.invoiceNumber,
          ...contact,
          lineItems: lineItems.map(xeroCreditNoteLineItem),
          date: isoDate(invoice.createdAt),
          reference,
          gstEnabled: invoice.gstEnabled,
        }).then((pushed) => ({ xeroInvoiceId: pushed.xeroCreditNoteId, contactId: pushed.contactId }))
      : await pushClientInvoiceToXero({
          idempotencyKey: `client-invoice-${invoice.id}`,
          invoiceNumber: invoice.invoiceNumber,
          ...contact,
          lineItems,
          date: isoDate(invoice.createdAt),
          reference,
          gstEnabled: invoice.gstEnabled,
        });

    // Persist the Xero invoice id + export time, and remember the contact id so
    // future pushes reuse the same Xero contact instead of creating duplicates.
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "ClientInvoice" WHERE "id" = ${invoice.id} FOR UPDATE`;
      const current = await tx.clientInvoice.findUnique({ where: { id: invoice.id } });
      const metadata = current?.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata) ? current.metadata : {};
      await tx.clientInvoice.update({ where: { id: invoice.id }, data: { xeroInvoiceId: result.xeroInvoiceId, xeroExportedAt: new Date(), metadata: { ...metadata, xeroExportState: "EXPORTED" } } });
    });
    if (!invoice.client.xeroContactId && result.contactId) {
      await db.client.update({
        where: { id: invoice.clientId },
        data: { xeroContactId: result.contactId },
      });
    }

    return actionResult({ ok: true, xeroInvoiceId: result.xeroInvoiceId });
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not push invoice to Xero.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return actionResult({ error: message }, status);
  }
}
