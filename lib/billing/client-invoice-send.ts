/**
 * Email a client invoice and stamp it sent — moved verbatim out of
 * `app/api/admin/invoices/[id]/send/route.ts` so the single Send/Re-send action
 * and the bulk route share one implementation: the started-work review, the
 * VOID/PAID refusals, the PART_PAID status hold and the notification record.
 * A provider failure is reported as a refusal (502), never as sent.
 */
import { ClientInvoiceStatus, NotificationChannel, NotificationStatus } from "@prisma/client";
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
    // SENT. Only `sentAt` is restamped.
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
      return actionResult({ error: result.error ?? "Email provider failed." }, 502);
    }

    await db.clientInvoice.update({
      where: { id: invoice.id },
      data: {
        ...(keepsStatus ? {} : { status: ClientInvoiceStatus.SENT }),
        sentAt: new Date(),
      },
    });

    await db.notification.create({
      data: {
        channel: NotificationChannel.EMAIL,
        subject: template.subject,
        body: `Invoice ${invoice.invoiceNumber} sent to ${recipients.join(", ")}`,
        status: NotificationStatus.SENT,
        sentAt: new Date(),
      },
    });

    return actionResult({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not send invoice.";
    return actionResult({ error: message }, 400);
  }
}
