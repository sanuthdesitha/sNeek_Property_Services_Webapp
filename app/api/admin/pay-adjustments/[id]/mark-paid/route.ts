import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { routeSecurityRefusal, securityFromBody } from "@/lib/security/route-verification";
import { ADJUSTMENT_CLAIM_GUARD } from "@/lib/finance/pay-adjustments";
import { markPaidRefusal, undoPaidRefusal } from "@/lib/pay-adjustments/lifecycle";

/**
 * Mark ONE approved pay request paid outside the system (cash, a separate
 * transfer), or undo that (2026-11-18).
 *
 * Paid-outside is the third settlement marker: once set, no cleaner invoice and
 * no payroll run may select the request (`adjustmentUnsettledWhere`). The claim
 * is a guarded `updateMany` on all three markers being empty, so it cannot race
 * a payroll run or an invoice claim into paying twice — the loser updates 0 rows
 * and is told which one won.
 *
 * Administrators only, with their own PIN (`pay_requests.mark_paid`, the same
 * tier as sending a pay run's payouts), refused while testing as someone else.
 * Nothing is emailed: the cleaner sees it in the request's history.
 */

const METHODS = ["BANK_TRANSFER", "CASH", "CARD", "OTHER"] as const;

const markSchema = z.object({
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date the money was paid."),
  method: z.enum(METHODS),
  reference: z.string().trim().max(200).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
});

const undoSchema = z.object({
  reason: z.string().trim().min(3, "Say why the payment is being undone.").max(2000),
});

function errorResponse(err: unknown, fallback: string) {
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: err.issues[0]?.message ?? fallback }, { status: 400 });
  }
  const message = err instanceof Error && err.message ? err.message : fallback;
  const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
  return NextResponse.json({ error: message }, { status });
}

async function settlementLabels(row: { includedInCleanerInvoiceId: string | null }) {
  if (!row.includedInCleanerInvoiceId) return {};
  const invoice = await db.cleanerInvoiceSubmission.findUnique({
    where: { id: row.includedInCleanerInvoiceId },
    select: { invoiceNumber: true, status: true },
  });
  return { cleanerInvoiceNumber: invoice?.invoiceNumber ?? null, cleanerInvoiceStatus: invoice?.status ?? null };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const raw = await req.json().catch(() => ({}));
    const refusal = await routeSecurityRefusal(session, securityFromBody(raw) ?? null, "pay_requests.mark_paid");
    if (refusal) return refusal;
    const body = markSchema.parse(raw);

    const existing = await db.cleanerPayAdjustment.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: "Pay request not found." }, { status: 404 });
    const why = markPaidRefusal(existing, await settlementLabels(existing));
    if (why) return NextResponse.json({ error: why }, { status: 409 });

    const paidOutsideDate = new Date(`${body.paidDate}T00:00:00.000Z`);
    if (Number.isNaN(paidOutsideDate.getTime())) {
      return NextResponse.json({ error: "Enter the date the money was paid." }, { status: 400 });
    }

    const claim = await db.cleanerPayAdjustment.updateMany({
      where: { id: existing.id, status: "APPROVED", updatedAt: existing.updatedAt, ...ADJUSTMENT_CLAIM_GUARD },
      data: {
        paidOutsideAt: new Date(),
        paidOutsideDate,
        paidOutsideMethod: body.method,
        paidOutsideReference: body.reference?.trim() || null,
        paidOutsideNote: body.note?.trim() || null,
        paidOutsideById: session.user.id,
      },
    });
    if (claim.count !== 1) {
      const current = await db.cleanerPayAdjustment.findUnique({ where: { id: existing.id } });
      const reason = current ? markPaidRefusal(current, await settlementLabels(current)) : "Pay request not found.";
      return NextResponse.json(
        { error: reason ?? "This request changed while you were marking it paid. Refresh and try again." },
        { status: 409 }
      );
    }

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: existing.jobId ?? undefined,
        action: "PAY_ADJUSTMENT_MARKED_PAID",
        entity: "CleanerPayAdjustment",
        entityId: existing.id,
        before: { paidOutsideAt: null } as never,
        after: {
          paidOutsideDate: body.paidDate,
          paidOutsideMethod: body.method,
          paidOutsideReference: body.reference?.trim() || null,
          paidOutsideNote: body.note?.trim() || null,
          approvedAmount: existing.approvedAmount,
        } as never,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, "Could not mark the request paid.");
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const raw = await req.json().catch(() => ({}));
    const refusal = await routeSecurityRefusal(session, securityFromBody(raw) ?? null, "pay_requests.mark_paid");
    if (refusal) return refusal;
    const body = undoSchema.parse(raw);

    const existing = await db.cleanerPayAdjustment.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: "Pay request not found." }, { status: 404 });
    const why = undoPaidRefusal(existing);
    if (why) return NextResponse.json({ error: why }, { status: 409 });

    const released = await db.cleanerPayAdjustment.updateMany({
      where: {
        id: existing.id,
        updatedAt: existing.updatedAt,
        paidOutsideAt: { not: null },
        includedInPayrollRunId: null,
        includedInCleanerInvoiceId: null,
      },
      data: {
        paidOutsideAt: null,
        paidOutsideDate: null,
        paidOutsideMethod: null,
        paidOutsideReference: null,
        paidOutsideNote: null,
        paidOutsideById: null,
      },
    });
    if (released.count !== 1) {
      return NextResponse.json({ error: "This request changed while you were undoing it. Refresh and try again." }, { status: 409 });
    }

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: existing.jobId ?? undefined,
        action: "PAY_ADJUSTMENT_PAID_UNDONE",
        entity: "CleanerPayAdjustment",
        entityId: existing.id,
        before: {
          paidOutsideAt: existing.paidOutsideAt?.toISOString() ?? null,
          paidOutsideDate: existing.paidOutsideDate?.toISOString().slice(0, 10) ?? null,
          paidOutsideMethod: existing.paidOutsideMethod,
          paidOutsideReference: existing.paidOutsideReference,
          paidOutsideNote: existing.paidOutsideNote,
        } as never,
        after: { paidOutsideAt: null, changeReason: body.reason } as never,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, "Could not undo the payment.");
  }
}
