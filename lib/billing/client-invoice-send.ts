/**
 * Email a client invoice and stamp it sent — moved verbatim out of
 * `app/api/admin/invoices/[id]/send/route.ts` so the single Send/Re-send action
 * and the bulk route share one implementation: the started-work review, the
 * VOID/PAID refusals, the PART_PAID status hold and the notification record.
 * A provider failure is reported as a refusal (502), never as sent.
 */
import { ClientInvoiceStatus, NotificationChannel, NotificationStatus, type Prisma } from "@prisma/client";
import { getClientInvoice, renderClientInvoicePdf } from "@/lib/billing/client-invoices";
import { getAppSettings } from "@/lib/settings";
import { resolveClientDeliveryRecipients } from "@/lib/commercial/delivery-profiles";
import { renderEmailTemplate } from "@/lib/email-templates";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { db } from "@/lib/db";
import { assertStartedWorkReviewed } from "@/lib/billing/started-work-reconciliation";
import { actionResult, type InvoiceActionResult } from "./invoice-action-result";
import { emptyInvoiceRefusal } from "./client-invoice-guards";
import { creditNoteTotalRefusal } from "./client-invoice-adjustments";
import { creditLimitFor } from "./client-invoice-patch-rules";
import { recordInvoiceAudit } from "./client-invoice-audit";
import { termsSnapshotFor } from "./invoice-terms";
import { refreshCreditCoverage } from "./invoice-job-release";

/**
 * Stamp a successful send under the row lock. `sentAt` is the FIRST time the
 * document went to the client: "Invoiced this month" and the issued record read
 * it, so a re-send never moves it. Re-sends are kept in metadata.resentAt[]
 * (and each has its own History row). The first send also snapshots the
 * payment terms, and a credit note being issued refreshes whether its invoice
 * is now fully credited. Returns true for a re-send.
 */
async function recordSent(invoiceId: string, keepsStatus: boolean, actorId: string | null): Promise<boolean> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ClientInvoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
    const current = await tx.clientInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { clientId: true, status: true, kind: true, creditsInvoiceId: true, sentAt: true, paymentTermsDays: true, metadata: true },
    });
    const now = new Date();
    const resend = current.sentAt !== null;
    const metadata = (current.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata) ? current.metadata : {}) as Record<string, unknown>;
    const resentAt = Array.isArray(metadata.resentAt) ? (metadata.resentAt as unknown[]) : [];
    const nextStatus = keepsStatus ? current.status : ClientInvoiceStatus.SENT;
    const termsSnapshot = await termsSnapshotFor(tx, current, nextStatus);
    await tx.clientInvoice.update({
      where: { id: invoiceId },
      data: {
        ...(keepsStatus ? {} : { status: ClientInvoiceStatus.SENT }),
        ...(resend ? { metadata: { ...metadata, resentAt: [...resentAt, now.toISOString()].slice(-50) } as Prisma.InputJsonValue } : { sentAt: now }),
        ...(termsSnapshot !== undefined ? { paymentTermsDays: termsSnapshot } : {}),
      },
    });
    if (current.kind === "CREDIT_NOTE" && current.creditsInvoiceId && current.status !== nextStatus && actorId) {
      await refreshCreditCoverage(tx, { invoiceId: current.creditsInvoiceId, actorId });
    }
    return resend;
  });
}

/** The client portal's page for one invoice (also used for credit notes). */
export function clientInvoiceUrl(origin: string, invoiceId: string): string {
  return `${origin}/v2/client/finance/invoices/${encodeURIComponent(invoiceId)}`;
}

export async function sendClientInvoice(input: {
  invoiceId: string;
  /** Explicit recipient; blank uses the client's delivery profile. */
  to?: unknown;
  /** Origin used for the link in the email body. */
  origin: string;
  /** Who sent it, for the invoice's History. */
  actorId?: string | null;
}): Promise<InvoiceActionResult> {
  try {
    const [invoice, settings] = await Promise.all([getClientInvoice(input.invoiceId), getAppSettings()]);
    if (!invoice) {
      return actionResult({ error: "Invoice not found." }, 404);
    }

    await assertStartedWorkReviewed(invoice, db);

    // PAID and VOID are terminal, and this route was ignoring that — it set
    // SENT unconditionally. So sending a voided invoice moved it back to SENT,
    // putting a cancelled document back into the client's outstanding balance
    // and into the receivables figure. Emailing a PAID one does the same in
    // reverse: the payment stamps survive on a row the rest of the system now
    // reads as unpaid.
    if (
      invoice.status === ClientInvoiceStatus.VOID ||
      invoice.status === ClientInvoiceStatus.PAID
    ) {
      return actionResult(
        {
          error:
            invoice.status === ClientInvoiceStatus.VOID
              ? "This invoice is void. Generate a replacement rather than sending it again."
              : "This invoice is already paid. Sending it again would reopen it as unpaid.",
        }, 409);
    }

    // Chasing a PARTLY PAID invoice by emailing it again is routine, so the
    // send is allowed — but the status must NOT move. Writing SENT here would
    // discard the fact that money has already come in against it, which is
    // exactly what the graph refuses when it says PART_PAID cannot go back to
    // SENT. `sentAt` stays the FIRST send (see recordSent below).
    const keepsStatus = invoice.status === ClientInvoiceStatus.PART_PAID;

    const empty = emptyInvoiceRefusal(invoice);
    if (empty) return actionResult({ error: empty }, 409);
    // Sending a draft credit note issues it, so the credit limit applies here
    // exactly as it does to approving one (under the original's row lock).
    if (invoice.kind === "CREDIT_NOTE" && invoice.status === ClientInvoiceStatus.DRAFT) {
      const refusal = await db.$transaction(async (tx) => {
        const limit = await creditLimitFor(tx, invoice);
        if (!limit) return "The invoice this credit note credits could not be found.";
        return creditNoteTotalRefusal({
          total: invoice.totalAmount,
          remaining: limit.remaining,
          originalNumber: limit.originalNumber,
          requireCredit: true,
        });
      });
      if (refusal) return actionResult({ error: refusal }, 409);
    }

    const explicitTo = typeof input.to === "string" ? input.to.trim() : "";
    const recipients = explicitTo
      ? [explicitTo]
      : await resolveClientDeliveryRecipients({
          clientId: invoice.clientId,
          fallbackEmail: invoice.client.email ?? null,
          kind: "invoice",
        });
    if (!recipients.length) {
      return actionResult({ error: "No invoice recipient email found." }, 400);
    }

    const pdf = await renderClientInvoicePdf(invoice, settings.companyName || "sNeek Property Services", settings.logoUrl || settings.reportLogoUrl, settings.invoicing);
    const template = renderEmailTemplate(settings, "clientInvoiceIssued", {
      clientName: invoice.client.name,
      invoiceNumber: invoice.invoiceNumber,
      totalAmount: invoice.totalAmount.toFixed(2),
      actionLabel: invoice.kind === "CREDIT_NOTE" ? "View credit note" : "View invoice",
      // The client-facing invoice page in the client portal, never an admin page.
      actionUrl: clientInvoiceUrl(input.origin, invoice.id),
    });

    const result = await sendEmailDetailed({
      to: recipients,
      subject: template.subject,
      html: template.html,
      attachments: [
        {
          filename: `${invoice.invoiceNumber.toLowerCase()}.pdf`,
          content: pdf,
        },
      ],
      // A finance document the admin explicitly sent — a stale suppression
      // must not silently eat an invoice.
      transactional: true,
    });
    if (!result.ok) {
      await recordInvoiceAudit({
        actorId: input.actorId,
        invoiceId: invoice.id,
        action: "CLIENT_INVOICE_SENT",
        after: { outcome: "failed", error: result.error ?? "Email provider failed.", recipientCount: recipients.length },
      });
      return actionResult({ error: result.error ?? "Email provider failed." }, 502);
    }

    const resend = await recordSent(invoice.id, keepsStatus, input.actorId ?? null);

    await db.notification.create({
      data: {
        channel: NotificationChannel.EMAIL,
        subject: template.subject,
        body: `Invoice ${invoice.invoiceNumber} sent to ${recipients.join(", ")}`,
        status: NotificationStatus.SENT,
        sentAt: new Date(),
      },
    });

    // Who and when, the outcome and how many recipients; never the addresses'
    // contents or the email body.
    await recordInvoiceAudit({
      actorId: input.actorId,
      invoiceId: invoice.id,
      action: "CLIENT_INVOICE_SENT",
      after: { outcome: "sent", recipientCount: recipients.length, status: keepsStatus ? invoice.status : ClientInvoiceStatus.SENT, resend },
    });

    return actionResult({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not send invoice.";
    return actionResult({ error: message }, 400);
  }
}
