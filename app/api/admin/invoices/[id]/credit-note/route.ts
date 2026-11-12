import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { createCreditNote } from "@/lib/billing/client-invoice-create";

/**
 * POST → a DRAFT credit note against this SENT, PART_PAID or PAID invoice,
 * pre-filled with its lines negated. The original invoice is not changed.
 * Same roles as the other invoice actions; operations-pack checks are applied
 * by middleware to every /api/admin/invoices path.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const result = await createCreditNote(params.id, session.user);
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not create the credit note.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
