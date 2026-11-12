import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { batchGenerateSchema, runBatchGenerate } from "@/lib/billing/client-invoice-batch-generate";

/**
 * POST { requestKey, periodStart?, periodEnd?, periodBasis, gstEnabled? } →
 * the existing generator once per client with finished unbilled work, with
 * per-client outcomes. Same roles as POST /api/admin/invoices/generate (the
 * finance ops pack applies through middleware). Nothing is approved or sent.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const parsed = batchGenerateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a period and options." }, { status: 400 });
    }
    const result = await runBatchGenerate({ request: parsed.data, actorId: session.user.id });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not create the drafts.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
