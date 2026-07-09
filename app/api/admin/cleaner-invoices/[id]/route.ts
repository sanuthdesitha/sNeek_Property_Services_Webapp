import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

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
    } else {
      paymentData = {
        paidAt: null,
        paidAmount: null,
        paidBankAccount: null,
        paidNote: null,
        paymentMethod: null,
        paidDate: null,
      };
    }

    const updated = await db.cleanerInvoiceSubmission.update({
      where: { id: params.id },
      data: { status: body.status, ...paymentData },
    });

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
    if (delJobIds.length) {
      await db.job.updateMany({ where: { id: { in: delJobIds } }, data: { cleanerPaidAt: null } });
    }

    await db.cleanerInvoiceSubmission.delete({ where: { id: params.id } });

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
