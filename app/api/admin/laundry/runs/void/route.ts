import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { requireCapability } from "@/lib/rbac/can";
import { verifySensitiveAction } from "@/lib/security/admin-verification";
import { voidLaundryRun, voidLaundryRuns } from "@/lib/laundry/run-corrections";
import { correctionActor, runCorrectionErrorResponse, RUN_CORRECTION_HEADERS } from "@/lib/laundry/run-corrections-http";

export const dynamic = "force-dynamic";

const security = z.object({ pin: z.string().max(40).optional(), password: z.string().max(200).optional(), newPin: z.string().max(40).optional() }).strict();
const bodySchema = z.object({
  items: z.array(z.object({ taskId: z.string().trim().min(1).max(200), expectedUpdatedAt: z.string().datetime() })).min(1).max(50),
  reason: z.string().trim().min(3).max(2000),
  notifyTeam: z.boolean().optional(),
  security,
}).strict();

/**
 * POST — void one run, or several with one reason and one PIN. Administrators
 * (or a person an administrator granted laundry.void), acting as themselves,
 * with their own PIN. Each run answers voided or not voided with its reason.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    await requireCapability(session, "laundry.void");
    const body = bodySchema.parse(await req.json());
    await verifySensitiveAction(session.user.id, body.security, "laundry.void");
    const actor = correctionActor(session);
    if (body.items.length === 1) {
      const result = await voidLaundryRun(actor, { ...body.items[0], reason: body.reason, notifyTeam: body.notifyTeam });
      return NextResponse.json({ ok: true, result }, { headers: RUN_CORRECTION_HEADERS });
    }
    const outcomes = await voidLaundryRuns(actor, body.items, body.reason, body.notifyTeam === true);
    return NextResponse.json({ ok: true, outcomes }, { headers: RUN_CORRECTION_HEADERS });
  } catch (error) {
    return runCorrectionErrorResponse(error);
  }
}
