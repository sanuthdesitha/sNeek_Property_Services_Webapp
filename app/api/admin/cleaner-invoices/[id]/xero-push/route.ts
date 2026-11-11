import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { cleanerActionError, pushCleanerInvoiceOnce } from "@/lib/cleaner/invoice-admin-actions";

/**
 * Push an approved cleaner invoice to Xero as a DRAFT bill (ACCPAY), matching
 * or creating the Xero contact from the cleaner's details. Requires APPROVED
 * (or a retry of a pending export); see lib/cleaner/invoice-transitions.ts.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const outcome = await pushCleanerInvoiceOnce(params.id, session.user);
    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (err: unknown) {
    const outcome = cleanerActionError(err, "Could not push bill to Xero.");
    return NextResponse.json(outcome.body, { status: outcome.status });
  }
}
