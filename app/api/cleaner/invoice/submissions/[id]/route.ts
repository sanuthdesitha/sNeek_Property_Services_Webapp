import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  invoiceErrorMessage,
  invoiceErrorStatus,
  requireInvoicePayeeSession,
} from "@/lib/invoicing/access";

const patchSchema = z.object({
  // Exactly one transition is offered here. A payee can say "the money
  // arrived"; they cannot mark their own invoice PAID, void it, or push it to
  // Xero. Anything else is an admin action on the admin route.
  status: z.literal("PAID_CLAIMED"),
  note: z.string().trim().max(2000).optional(),
  proofKeys: z.array(z.string().trim().min(1).max(300)).max(5).optional(),
});

/**
 * The payee tells the business their invoice has been paid.
 *
 * This is a CLAIM, not a settlement. It moves the row to PAID_CLAIMED and puts
 * it in the Approval Center for an admin to confirm; the paid* block (amount,
 * method, bank account, date) is written only by that confirmation, because
 * that block is the business's record of money leaving, not the payee's.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireInvoicePayeeSession();
    const body = patchSchema.parse(await req.json().catch(() => ({})));

    const existing = await db.cleanerInvoiceSubmission.findUnique({
      where: { id: params.id },
      select: { id: true, cleanerId: true, status: true },
    });
    // Same 404 for "doesn't exist" and "isn't yours" — an id probe must not
    // reveal that someone else's invoice exists.
    if (!existing || existing.cleanerId !== session.user.id) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }

    if (existing.status === "PAID") {
      return NextResponse.json(
        { error: "This invoice is already recorded as paid by the office." },
        { status: 409 }
      );
    }
    if (existing.status !== "SUBMITTED" && existing.status !== "XERO_PUSHED") {
      return NextResponse.json(
        { error: `An invoice in ${existing.status} state cannot be claimed as paid.` },
        { status: 409 }
      );
    }

    const updated = await db.cleanerInvoiceSubmission.update({
      where: { id: params.id },
      data: {
        status: "PAID_CLAIMED",
        paidClaimedAt: new Date(),
        paidClaimedNote: body.note?.trim() || null,
        paidClaimedProofKeys: body.proofKeys?.length ? (body.proofKeys as any) : undefined,
      },
      select: { id: true, status: true, paidClaimedAt: true },
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CLEANER_INVOICE_PAY_CLAIMED",
        entity: "CleanerInvoiceSubmission",
        entityId: params.id,
        after: { status: updated.status, claimedAt: updated.paidClaimedAt } as any,
      },
    });

    return NextResponse.json({ ok: true, status: updated.status });
  } catch (err: any) {
    return NextResponse.json(
      { error: invoiceErrorMessage(err?.message) },
      { status: invoiceErrorStatus(err?.message) }
    );
  }
}
