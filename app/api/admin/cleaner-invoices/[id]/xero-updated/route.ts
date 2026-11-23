import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { markXeroBillUpdated } from "@/lib/cleaner/invoice-amend";

const schema = z.object({
  expectedUpdatedAt: z.string().trim().min(1).max(40),
  note: z.string().trim().min(3, "Say what you changed in Xero.").max(1000),
});

/**
 * POST — the office records that it updated the Xero bill by hand after an
 * amendment, clearing "needs updating in Xero" (2026-11-23). Nothing is sent to
 * Xero; the note and the person are audited.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Say what you changed in Xero." }, { status: 400 });
    const outcome = await markXeroBillUpdated({
      id: params.id,
      actor: { userId: session.impersonation?.actorId ?? session.user.id, role: String(session.user.role), impersonating: Boolean(session.impersonation) },
      expectedUpdatedAt: parsed.data.expectedUpdatedAt,
      note: parsed.data.note,
    });
    if (!outcome.ok) return NextResponse.json({ error: outcome.reason }, { status: outcome.status });
    return NextResponse.json(outcome);
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Nothing was recorded. Try again." : message }, { status });
  }
}
