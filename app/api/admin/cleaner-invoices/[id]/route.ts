import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { releaseCleanerInvoiceConsumables } from "@/lib/cleaner/invoice-release";

const patchSchema = z
  .object({
    status: z.enum(["SUBMITTED", "XERO_PUSHED", "PAID", "VOID"]),
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
    } else if (body.status === "VOID" || body.status === "SUBMITTED") {
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
      if (body.status === "VOID") {
        released = await releaseCleanerInvoiceConsumables(tx, params.id);
      }
      return tx.cleanerInvoiceSubmission.update({
        where: { id: params.id },
        data: { status: body.status, ...paymentData },
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
      } else if (body.status === "VOID") {
        await db.job.updateMany({ where: { id: { in: jobIds } }, data: { cleanerPaidAt: null } });
      }
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
