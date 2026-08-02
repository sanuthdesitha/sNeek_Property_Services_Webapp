import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  invoiceErrorMessage,
  invoiceErrorStatus,
  requireInvoicePayeeSession,
} from "@/lib/invoicing/access";

/**
 * The signed-in payee's own past invoice submissions with their status.
 * Scoped to `session.user.id` — a QA inspector (now allowed on this route) can
 * only ever read their own rows.
 */
export async function GET() {
  try {
    const session = await requireInvoicePayeeSession();
    const rows = await db.cleanerInvoiceSubmission.findMany({
      where: { cleanerId: session.user.id },
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        hours: true,
        totalAmount: true,
        jobCount: true,
        status: true,
        createdAt: true,
        // The payee's own "I've been paid" claim, so the list can show it as
        // awaiting confirmation rather than looking unchanged after they said so.
        paidClaimedAt: true,
        paidClaimedNote: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json(rows);
  } catch (err: any) {
    return NextResponse.json(
      { error: invoiceErrorMessage(err?.message) },
      { status: invoiceErrorStatus(err?.message) }
    );
  }
}
