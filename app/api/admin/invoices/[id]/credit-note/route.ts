import { NextRequest, NextResponse } from "next/server";
import { capabilityRefusal } from "@/lib/rbac/capability-http";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { createCreditNote } from "@/lib/billing/client-invoice-create";
import { voidCreditSecurityRefusal } from "@/lib/billing/client-invoice-void-guard";

/**
 * POST → a DRAFT credit note against this SENT, PART_PAID or PAID invoice,
 * pre-filled with its lines negated. The original invoice is not changed.
 * Same roles as the other invoice actions; operations-pack checks are applied
 * by middleware to every /api/admin/invoices path. A sensitive action (owner
 * decision 2026-11-13): `invoices.void_credit` (Finance at Full or the grant)
 * and the acting person's own PIN in `{ security }`.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const refusal = await capabilityRefusal(session, ["invoices.void_credit"]);
    if (refusal) return refusal;
    const body: unknown = await req.json().catch(() => ({}));
    const actor = { ...session.user, impersonatedBy: session.impersonation?.actorId ?? null };
    const pinRefusal = await voidCreditSecurityRefusal(actor, body);
    if (pinRefusal) return NextResponse.json(pinRefusal.body, { status: pinRefusal.status });
    const result = await createCreditNote(params.id, session.user);
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not create the credit note.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
