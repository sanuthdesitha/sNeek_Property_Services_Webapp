import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import {
  applyCleanerInvoiceStatus,
  cleanerActionError,
  cleanerInvoicePatchSchema,
  deleteCleanerInvoice,
} from "@/lib/cleaner/invoice-admin-actions";

/**
 * PATCH { status, … } — approve (ADMIN only), request changes, record payment,
 * reverse, or reject a payment claim. Every move is checked against the one
 * transition table (lib/cleaner/invoice-transitions.ts) and audited; see
 * lib/cleaner/invoice-admin-actions.ts.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = cleanerInvoicePatchSchema.parse(await req.json().catch(() => ({})));
    const outcome = await applyCleanerInvoiceStatus({ id: params.id, body, actor: session.user });
    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (err: unknown) {
    const outcome = cleanerActionError(err, "Could not update invoice status.");
    return NextResponse.json(outcome.body, { status: outcome.status });
  }
}

/**
 * Hard-delete a cleaner invoice submission. Blocked once it's in Xero or paid.
 * Deleting frees the cleaner to resend a corrected invoice for the same period.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const outcome = await deleteCleanerInvoice(params.id, session.user);
    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (err: unknown) {
    const outcome = cleanerActionError(err, "Could not delete invoice.");
    return NextResponse.json(outcome.body, { status: outcome.status });
  }
}
