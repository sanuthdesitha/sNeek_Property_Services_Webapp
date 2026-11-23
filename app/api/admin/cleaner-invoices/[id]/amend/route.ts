import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { amendCleanerInvoice, amendRequestSchema } from "@/lib/cleaner/invoice-amend";

/**
 * POST — amend a submitted cleaner (payee) invoice: lines, amounts,
 * quantities, added and removed lines, hours, with a required reason
 * (2026-11-23). ADMIN and OPS_MANAGER (the payroll pack through middleware);
 * after approval only ADMIN (lib/cleaner/invoice-amend-rules.ts). Idempotent by
 * `requestKey`, refused when stale, refused while testing as someone else.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const parsed = amendRequestSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "The amendment could not be read." }, { status: 400 });
    const outcome = await amendCleanerInvoice({
      id: params.id,
      actor: { userId: session.impersonation?.actorId ?? session.user.id, role: String(session.user.role), impersonating: Boolean(session.impersonation) },
      request: parsed.data,
    });
    if (!outcome.ok) return NextResponse.json({ error: outcome.reason }, { status: outcome.status });
    return NextResponse.json(outcome);
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "The amendment was not saved. Your changes are still on screen; try again." : message }, { status });
  }
}
