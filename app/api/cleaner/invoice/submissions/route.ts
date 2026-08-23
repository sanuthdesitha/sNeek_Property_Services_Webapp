import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publicUrl } from "@/lib/s3";
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
        // Selected explicitly: this list is a narrow `select`, so leaving it out
        // does not error — the field simply arrives undefined and the payee's
        // invoice number renders as a blank.
        invoiceNumber: true,
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
        paidClaimedProofKeys: true,
        // The office sending an invoice back is the one status the payee has to
        // ACT on. Same narrow-select trap as invoiceNumber above: omit these and
        // the panel renders a returned invoice with no reason and no date, which
        // is indistinguishable from one still sitting with accounts.
        changesRequestedAt: true,
        changesRequestedNote: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json(
      rows.map((row) => ({
        ...row,
        // The payee sees the receipt they attached, so a claim they made weeks
        // ago is still self-explanatory while it waits on the office.
        paidClaimedProofUrls: Array.isArray(row.paidClaimedProofKeys)
          ? row.paidClaimedProofKeys
              .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
              .map((key) => ({ key, url: publicUrl(key) }))
          : [],
      }))
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: invoiceErrorMessage(err?.message) },
      { status: invoiceErrorStatus(err?.message) }
    );
  }
}
