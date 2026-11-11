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
import { pushClientInvoiceToXero } from "@/lib/xero/client";
import { getPhase3IntegrationsSettings } from "@/lib/phase3/integrations";
import { actionResult, type InvoiceActionResult } from "./invoice-action-result";

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function pushClientInvoiceToXeroOnce(invoiceId: string): Promise<InvoiceActionResult> {
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
    const reference =
      invoice.periodStart && invoice.periodEnd
        ? `Service period ${isoDate(invoice.periodStart)} – ${isoDate(invoice.periodEnd)}`
        : undefined;

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

    const result = await pushClientInvoiceToXero({
      idempotencyKey: `client-invoice-${invoice.id}`,
      invoiceNumber: invoice.invoiceNumber,
      clientName: invoice.client.name || "Unknown Client",
      clientEmail: invoice.client.email || integrations.xero.contactFallbackEmail || "no-reply@sneekops.com.au",
      clientXeroContactId: invoice.client.xeroContactId ?? undefined,
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
