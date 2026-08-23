import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { pushCleanerBillToXero } from "@/lib/xero/client";
import {
  payeeKindFromSnapshot,
  payeeKindLabel,
  xeroLineFallbackDescription,
} from "@/lib/invoicing/payee-kind";

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Push a cleaner-submitted invoice to Xero as a DRAFT bill (ACCPAY), matching or
 *  creating the Xero contact from the cleaner's details. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const sub = await db.cleanerInvoiceSubmission.findUnique({ where: { id: params.id } });
    if (!sub) return NextResponse.json({ error: "Submission not found." }, { status: 404 });
    if (sub.xeroBillId) return NextResponse.json({ error: "This invoice is already in Xero." }, { status: 409 });

    const data = (sub.lineData ?? {}) as any;
    const contact = (data.contact ?? {}) as Record<string, any>;
    const lines = Array.isArray(data.lines) ? data.lines : [];
    if (lines.length === 0) {
      return NextResponse.json({ error: "This invoice has no line items to push." }, { status: 400 });
    }

    const cleaner = await db.user.findUnique({
      where: { id: sub.cleanerId },
      select: { name: true, email: true, phone: true, role: true },
    });

    // What this bill actually CONTAINS, read off the snapshot written at send
    // time. Historical invoices stored a bare Role there and are interpreted
    // rather than rewritten — the snapshot is the document that was sent.
    //
    // A person may now both clean and inspect, so one bill can hold both kinds
    // of line. The invoice-level label names the payee; the LINE-level label
    // below follows whichever stream produced each line, which is the part that
    // was previously wrong.
    const payeeKind = payeeKindFromSnapshot(
      (data.payeeRole as string | undefined) ?? cleaner?.role ?? null
    );
    const payeeLabel = payeeKindLabel(payeeKind);

    const result = await pushCleanerBillToXero({
      cleanerName: contact.name || cleaner?.name || payeeLabel,
      cleanerEmail: contact.email || cleaner?.email || "no-reply@sneekops.com.au",
      cleanerPhone: contact.phone || cleaner?.phone || undefined,
      cleanerAddress: contact.address || undefined,
      reference: `${payeeLabel} invoice ${isoDate(sub.periodStart)} – ${isoDate(sub.periodEnd)}`,
      lineItems: lines.map((l: any) => ({
        // PER LINE, from the tag the send route stamped on it. Previously ONE
        // label derived from the account's role was applied to every line, so a
        // bill holding both cleans and inspections described all of it as one
        // kind — the wrong description against real money, found at
        // reconciliation rather than at send.
        //
        // Invoices sent before the tag existed have no `kind`; they fall back to
        // the invoice-level kind, which for them is accurate because a person
        // could only be one thing when they were raised.
        description: String(
          l.description ??
            xeroLineFallbackDescription(
              l.kind === "INSPECTION" || (!l.kind && payeeKind === "INSPECTIONS")
                ? "INSPECTION"
                : "CLEANING"
            )
        ),
        quantity: Number(l.quantity ?? 1),
        unitAmount: Number(l.unitAmount ?? 0),
      })),
    });

    await db.cleanerInvoiceSubmission.update({
      where: { id: sub.id },
      data: { status: "XERO_PUSHED", xeroBillId: result.xeroBillId, xeroExportedAt: new Date() },
    });

    return NextResponse.json({ ok: true, xeroBillId: result.xeroBillId });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not push bill to Xero." }, { status });
  }
}
