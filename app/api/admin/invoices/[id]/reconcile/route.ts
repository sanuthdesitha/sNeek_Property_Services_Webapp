import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { verifySensitiveAction } from "@/lib/security/admin-verification";
import { releaseInvoiceConsumables } from "@/lib/billing/client-invoices";
import { LIVE_CREDIT_NOTES_REFUSAL } from "@/lib/billing/client-invoice-adjustments";
import { creditNoteVoidRebillRefusal, refreshCreditCoverage, returnInvoicedJobsToBillable } from "@/lib/billing/invoice-job-release";

const schema = z.object({
  reason: z.string().trim().min(10).max(2000),
  reference: z.string().trim().min(3).max(500),
  confirmedInXero: z.literal(true),
  security: z.object({
    pin: z.string().optional(),
    password: z.string().optional(),
  }),
});

/** Record an externally reconciled void; never erase issued accounting history. */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation) throw new Error("FORBIDDEN");
    const body = schema.parse(await request.json());
    await verifySensitiveAction(
      session.user.id,
      body.security,
      "invoices.correct",
    );
    await db.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "ClientInvoice" WHERE "id" = ${params.id} FOR UPDATE`;
      const invoice = await transaction.clientInvoice.findUnique({
        where: { id: params.id },
        include: { payments: { select: { status: true } } },
      });
      if (!invoice) throw new Error("Invoice not found.");
      if (invoice.status === "VOID") return; // Idempotent retry after a lost response.
      const metadata = (invoice.metadata ?? {}) as Record<string, unknown>;
      if (metadata.xeroExportState === "PENDING")
        throw new Error(
          "Reconcile the pending Xero export before voiding this invoice.",
        );
      if (!invoice.xeroInvoiceId && !invoice.xeroExportedAt)
        throw new Error(
          "Use the standard void action for an unexported invoice.",
        );
      if (
        invoice.status === "PAID" ||
        invoice.status === "PART_PAID" ||
        invoice.paidAt ||
        Number(invoice.paidAmount ?? 0) > 0 ||
        invoice.stripePaymentIntentId ||
        invoice.payments?.some(
          (payment) =>
            payment.status === "PENDING" || payment.status === "SUCCEEDED",
        )
      )
        throw new Error(
          "This invoice has payment evidence. Reconcile its payment or credit note before a correction; paid records cannot be voided here.",
        );
      if (invoice.kind === "CREDIT_NOTE") {
        const rebill = await creditNoteVoidRebillRefusal(transaction, invoice);
        if (rebill) throw new Error(rebill);
      }
      if (invoice.kind === "INVOICE") {
        const liveCredits = await transaction.clientInvoice.count({
          where: { creditsInvoiceId: invoice.id, status: { not: "VOID" } },
        });
        if (liveCredits > 0) throw new Error(LIVE_CREDIT_NOTES_REFUSAL);
      }
      await releaseInvoiceConsumables(transaction, invoice.id);
      await transaction.clientInvoice.update({
        where: { id: invoice.id },
        data: { status: "VOID" },
      });
      // One invoiced rule: a voided invoice stops billing its jobs; a voided
      // credit note may stop its invoice being fully credited.
      if (invoice.kind === "INVOICE") {
        await returnInvoicedJobsToBillable(transaction, {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          reason: "voided",
          actorId: session.user.id,
        });
      } else if (invoice.creditsInvoiceId) {
        await refreshCreditCoverage(transaction, { invoiceId: invoice.creditsInvoiceId, actorId: session.user.id });
      }
      await transaction.auditLog.create({
        data: {
          userId: session.user.id,
          action: "CLIENT_INVOICE_XERO_RECONCILED_VOID",
          entity: "ClientInvoice",
          entityId: invoice.id,
          before: {
            status: invoice.status,
            xeroInvoiceId: invoice.xeroInvoiceId,
          },
          after: {
            status: "VOID",
            reason: body.reason,
            reference: body.reference,
            confirmedInXero: true,
            externalAction: "MANUALLY_CONFIRMED",
          },
        },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Could not reconcile invoice.";
    return NextResponse.json(
      { error: message },
      {
        status:
          message === "UNAUTHORIZED"
            ? 401
            : message === "FORBIDDEN"
              ? 403
              : 409,
      },
    );
  }
}
