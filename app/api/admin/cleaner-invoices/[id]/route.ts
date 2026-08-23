import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { releaseCleanerInvoiceConsumables } from "@/lib/cleaner/invoice-release";
import {
  clearsChangesNote,
  clearsPaymentRecord,
  releasesPayeeWork,
  requiresChangesNote,
} from "@/lib/cleaner/invoice-status";

const patchSchema = z
  .object({
    status: z.enum(["SUBMITTED", "CHANGES_REQUESTED", "XERO_PUSHED", "PAID", "VOID"]),
    /**
     * CHANGES_REQUESTED only — what the payee is meant to fix.
     *
     * Required, deliberately. Sending an invoice back without saying why
     * reliably produces the same invoice again, and the payee has no way to
     * guess which of twenty lines the office disagreed with.
     */
    changesNote: z.string().trim().min(1).max(2000).optional(),
    // Payment settlement — supplied when status === "PAID".
    paidAmount: z.number().nonnegative().optional(),
    paidBankAccount: z.string().trim().max(200).optional(),
    paidNote: z.string().trim().max(2000).optional(),
    paymentMethod: z.enum(["BANK_TRANSFER", "CARD", "CASH", "XERO", "OTHER"]).optional(),
    paidDate: z.string().optional(),
  })
  // A proper procedure requires HOW it was paid when marking it paid.
  .refine((v) => v.status !== "PAID" || Boolean(v.paymentMethod), {
    message: "A payment method is required when marking an invoice paid.",
    path: ["paymentMethod"],
  })
  .refine((v) => !requiresChangesNote(v.status) || Boolean(v.changesNote), {
    message: "Say what needs changing — the payee cannot guess which line is wrong.",
    path: ["changesNote"],
  });

/** Update a cleaner invoice submission's status (e.g. mark it paid). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json().catch(() => ({})));

    // Record payment settlement on PAID; clear it when reversed/re-opened.
    let paymentData: {
      paidAt: Date | null;
      paidAmount: number | null;
      paidBankAccount: string | null;
      paidNote: string | null;
      paymentMethod: string | null;
      paidDate: Date | null;
    };
    if (body.status === "PAID") {
      const existing = await db.cleanerInvoiceSubmission.findUnique({
        where: { id: params.id },
        select: { totalAmount: true },
      });
      paymentData = {
        paidAt: new Date(),
        paidAmount: body.paidAmount ?? existing?.totalAmount ?? 0,
        paidBankAccount: body.paidBankAccount || null,
        paidNote: body.paidNote || null,
        paymentMethod: body.paymentMethod || null,
        paidDate: body.paidDate ? new Date(body.paidDate) : new Date(),
      };
    } else if (clearsPaymentRecord(body.status)) {
      // Only an explicit reversal clears the payment record. This branch used
      // to catch EVERY non-PAID status, so moving a paid invoice to any other
      // state — including ones with nothing to do with payment — silently
      // erased when it was paid, how much, by which method and into which
      // account. That is the audit trail for money that actually left the
      // business, and it was being deleted as a side effect.
      paymentData = {
        paidAt: null,
        paidAmount: null,
        paidBankAccount: null,
        paidNote: null,
        paymentMethod: null,
        paidDate: null,
      };
    } else {
      // Any other status leaves the payment record untouched.
      paymentData = {} as typeof paymentData;
    }

    // VOIDING HANDS THE WORK BACK. Until now only the jobs were released, so a
    // voided invoice permanently swallowed the payee's approved extra pay,
    // their QA inspection fees and their out-of-pocket shopping — all still
    // stamped against an invoice that would never be paid, and all excluded
    // from every future invoice on exactly that stamp. Someone quietly stopped
    // being able to bill money they were owed.
    //
    // In the same transaction as the status change: a release that landed
    // against an invoice which then failed to void would let the same work be
    // billed on two live submissions.
    let released: Awaited<ReturnType<typeof releaseCleanerInvoiceConsumables>> | null = null;
    const updated = await db.$transaction(async (tx) => {
      // Both a void and a send-back hand the work back. The difference is
      // intent, not mechanics: a void ends this invoice, a send-back asks for a
      // better one — and neither is any use to the payee if the items stay
      // stamped and cannot be re-billed.
      if (releasesPayeeWork(body.status)) {
        released = await releaseCleanerInvoiceConsumables(tx, params.id);
      }
      return tx.cleanerInvoiceSubmission.update({
        where: { id: params.id },
        data: {
          status: body.status,
          ...paymentData,
          ...(requiresChangesNote(body.status)
            ? { changesRequestedAt: new Date(), changesRequestedNote: body.changesNote ?? null }
            : {}),
          // Cleared when the invoice moves on, so a resubmitted or paid invoice
          // does not keep showing the note from the round before.
          ...(clearsChangesNote(body.status)
            ? { changesRequestedAt: null, changesRequestedNote: null }
            : {}),
        },
      });
    });

    if (released) {
      logger.info(
        { submissionId: params.id, ...(released as object) },
        "[cleaner-invoice] voided; the payee's items are billable again"
      );
    }

    // Stamp / clear the covered jobs so they show as paid to the cleaner (and,
    // when reversed, become re-invoiceable). jobIds are snapshotted at send time.
    const jobIds = Array.isArray((updated.lineData as any)?.jobIds)
      ? ((updated.lineData as any).jobIds as string[]).filter((x) => typeof x === "string")
      : [];
    if (jobIds.length) {
      if (body.status === "PAID") {
        await db.job.updateMany({ where: { id: { in: jobIds } }, data: { cleanerPaidAt: new Date() } });
      } else if (releasesPayeeWork(body.status)) {
        await db.job.updateMany({ where: { id: { in: jobIds } }, data: { cleanerPaidAt: null } });
      }
    }

    // TELL THE PAYEE. A send-back they never hear about is just an invoice that
    // stopped moving — they believe it is with accounts, the office believes the
    // ball is with them, and the first anyone notices is a missing payment.
    //
    // After the write and best-effort: the decision is already recorded, and
    // failing the response over a mail error would tell the admin the send-back
    // did not happen when it did.
    // REMITTANCE ADVICE. Marking a payee invoice paid sent nothing, so somebody
    // did the work, invoiced for it, and money arrived in their account with no
    // idea which invoice it settled or whether it was the full amount. That is
    // the question they then ask by message, every fortnight.
    if (body.status === "PAID") {
      void sendPayeeRemittance(params.id).catch((err) =>
        logger.error(
          { err, submissionId: params.id },
          "[cleaner-invoice] marked paid but the remittance advice could not be sent"
        )
      );
    }

    if (requiresChangesNote(body.status)) {
      await notifyPayeeOfChangeRequest(params.id, body.changesNote ?? "").catch((err) =>
        logger.error(
          { err, submissionId: params.id },
          "[cleaner-invoice] changes requested but the payee could not be emailed"
        )
      );
    }

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CLEANER_INVOICE_STATUS_UPDATE",
        entity: "CleanerInvoiceSubmission",
        entityId: params.id,
        after: { status: body.status, ...paymentData } as any,
      },
    });

    return NextResponse.json({ ok: true, status: updated.status });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update invoice status." }, { status });
  }
}

/**
 * Hard-delete a cleaner invoice submission. Blocked once it's in Xero (reverse it
 * there first). Deleting frees the cleaner to resend a corrected invoice for the
 * same period (the send flow always creates a fresh submission).
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const existing = await db.cleanerInvoiceSubmission.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: "Submission not found." }, { status: 404 });
    if (existing.xeroBillId) {
      return NextResponse.json(
        { error: "This invoice is already in Xero. Void it in Xero before deleting." },
        { status: 409 }
      );
    }

    // Free the covered jobs — clear any paid stamp so they can be re-invoiced.
    const delJobIds = Array.isArray((existing.lineData as any)?.jobIds)
      ? ((existing.lineData as any).jobIds as string[]).filter((x) => typeof x === "string")
      : [];
    // Same release as a void, and for the same reason — a deleted submission
    // must not take the payee's adjustments, inspection fees and shopping with
    // it. Deleting is the more dangerous of the two: the row is gone, so there
    // is nothing left to trace the stranded stamps back to.
    const deleteReleased = await db.$transaction(async (tx) => {
      const counts = await releaseCleanerInvoiceConsumables(tx, params.id);
      if (delJobIds.length) {
        await tx.job.updateMany({ where: { id: { in: delJobIds } }, data: { cleanerPaidAt: null } });
      }
      await tx.cleanerInvoiceSubmission.delete({ where: { id: params.id } });
      return counts;
    });
    logger.info(
      { submissionId: params.id, ...deleteReleased },
      "[cleaner-invoice] deleted; the payee's items are billable again"
    );

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CLEANER_INVOICE_DELETE",
        entity: "CleanerInvoiceSubmission",
        entityId: params.id,
        before: { status: existing.status, totalAmount: existing.totalAmount } as any,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not delete invoice." }, { status });
  }
}

/**
 * Email the payee that their invoice needs work, with the reason.
 *
 * The reason is the whole point. An invoice returned with no explanation comes
 * back unchanged, and the second round costs both people the same time as the
 * first.
 */
async function notifyPayeeOfChangeRequest(submissionId: string, note: string): Promise<void> {
  // Two queries because CleanerInvoiceSubmission carries a bare `cleanerId`
  // with no relation to User — there is nothing to include.
  const submission = await db.cleanerInvoiceSubmission.findUnique({
    where: { id: submissionId },
    select: { invoiceNumber: true, periodStart: true, periodEnd: true, cleanerId: true },
  });
  if (!submission) return;

  const payee = await db.user.findUnique({
    where: { id: submission.cleanerId },
    select: { name: true, email: true, role: true },
  });
  if (!payee?.email) return;

  const { sendEmailDetailed } = await import("@/lib/notifications/email");
  const { getAppSettings } = await import("@/lib/settings");
  const { resolveAppUrl } = await import("@/lib/app-url");
  const settings = await getAppSettings();

  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fmt = (date: Date) =>
    new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);

  // QA inspectors self-invoice on this same rail, so the link has to land in
  // THEIR portal rather than always the cleaner one.
  const href = payee.role === Role.QA_INSPECTOR ? "/v2/qa/invoices" : "/v2/cleaner/invoices";

  await sendEmailDetailed({
    kind: "job_assignment",
    to: payee.email,
    subject: `Your invoice needs a change${submission.invoiceNumber ? ` — ${submission.invoiceNumber}` : ""}`,
    // A finance document the office explicitly sent back — a stale suppression
    // must not silently eat it.
    transactional: true,
    html: [
      `<p>Hi ${escape(payee.name ?? "there")},</p>`,
      `<p>Your invoice for ${escape(fmt(submission.periodStart))} – ${escape(fmt(submission.periodEnd))}`,
      submission.invoiceNumber ? ` (<strong>${escape(submission.invoiceNumber)}</strong>)` : "",
      ` has been sent back for a change.</p>`,
      `<p><strong>What needs fixing:</strong><br/>${escape(note).replace(/\n/g, "<br/>")}</p>`,
      `<p>Everything on it is available to invoice again, so you can correct it and resend.</p>`,
      `<p><a href="${resolveAppUrl(href)}">Open your invoices</a></p>`,
      `<p>— ${escape(settings.companyName)}</p>`,
    ].join(""),
  });
}


/**
 * Tell a payee that money has been sent, and what it covers.
 *
 * Read AFTER the write so the figures are the ones now stored rather than the
 * ones the request proposed — an admin who adjusted the amount would otherwise
 * have the original emailed out.
 */
async function sendPayeeRemittance(submissionId: string): Promise<void> {
  const submission = await db.cleanerInvoiceSubmission.findUnique({
    where: { id: submissionId },
    select: {
      invoiceNumber: true,
      periodStart: true,
      periodEnd: true,
      totalAmount: true,
      paidAmount: true,
      paidBankAccount: true,
      paidNote: true,
      paymentMethod: true,
      paidDate: true,
      cleanerId: true,
    },
  });
  if (!submission) return;

  const payee = await db.user.findUnique({
    where: { id: submission.cleanerId },
    select: { name: true, email: true },
  });
  if (!payee?.email) return;

  const { sendEmailDetailed } = await import("@/lib/notifications/email");
  const { getAppSettings } = await import("@/lib/settings");
  const { buildPayeeRemittanceAdvice } = await import("@/lib/finance/payment-notices");
  const settings = await getAppSettings();

  const email = buildPayeeRemittanceAdvice({
    recipientName: payee.name,
    invoiceNumber: submission.invoiceNumber,
    // paidAmount is what actually went out; totalAmount is what was asked for,
    // and the two differ whenever the office settled a different figure.
    amount: Number(submission.paidAmount ?? submission.totalAmount ?? 0),
    method: submission.paymentMethod ?? "OTHER",
    paidDate: submission.paidDate ?? new Date(),
    bankAccount: submission.paidBankAccount,
    note: submission.paidNote,
    periodStart: submission.periodStart,
    periodEnd: submission.periodEnd,
    companyName: settings.companyName,
  });

  await sendEmailDetailed({
    kind: "auto_invoice",
    to: payee.email,
    subject: email.subject,
    html: email.html,
    // Money that has left the business. A stale suppression must not eat it.
    transactional: true,
  });
}
