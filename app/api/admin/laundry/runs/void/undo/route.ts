import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { requireCapability } from "@/lib/rbac/can";
import { verifySensitiveAction } from "@/lib/security/admin-verification";
import { undoLaundryRunVoid } from "@/lib/laundry/run-corrections";
import { correctionActor, runCorrectionErrorResponse, RUN_CORRECTION_HEADERS } from "@/lib/laundry/run-corrections-http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  taskId: z.string().trim().min(1).max(200),
  expectedUpdatedAt: z.string().datetime(),
  // Required since 2026-11-14 (quick pick or "Other…" text, no minimum length):
  // undoing a void changes counts, the partner portal and reports again.
  reason: z.string().trim().min(1).max(2000),
  security: z.object({ pin: z.string().max(40).optional(), password: z.string().max(200).optional(), newPin: z.string().max(40).optional() }).strict(),
}).strict();

/** POST — Undo void: restores the state before the void. Same rights and PIN as Void. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    await requireCapability(session, "laundry.void");
    const body = bodySchema.parse(await req.json());
    await verifySensitiveAction(session.user.id, body.security, "laundry.void");
    const result = await undoLaundryRunVoid(correctionActor(session), body);
    return NextResponse.json({ ok: true, result }, { headers: RUN_CORRECTION_HEADERS });
  } catch (error) {
    return runCorrectionErrorResponse(error);
  }
}
