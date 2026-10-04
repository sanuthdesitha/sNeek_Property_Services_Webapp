import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { DeepCleanPlanningError, readDeepCleanPlan, scheduleDeepCleanProposal, verifyDeepCleanBaseline } from "@/lib/properties/deep-clean-planning";
const changeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify"), jobId: z.string().min(1), revision: z.number().int().nonnegative(), reviewNote: z.string().trim().min(1).max(2000), evidenceReviewed: z.literal(true) }),
  z.object({ action: z.literal("schedule"), proposalId: z.string().min(1), revision: z.number().int().nonnegative(), date: z.string().date() }),
]);
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Deep-clean planning could not be saved.";
  const status = error instanceof DeepCleanPlanningError ? error.status : message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
  return NextResponse.json({ error: error instanceof z.ZodError ? "Review the required fields before saving." : message }, { status });
}
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const result = await readDeepCleanPlan(params.id);
    return NextResponse.json({ ...result, canManage: (session.user.heldRoles ?? [session.user.role]).includes(Role.ADMIN) });
  } catch (error) { return failure(error); }
}
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const change = changeSchema.parse(await req.json());
    if (change.action === "verify") {
      const plan = await verifyDeepCleanBaseline({ ...change, propertyId: params.id }, session.user.id);
      return NextResponse.json({ plan });
    }
    return NextResponse.json(await scheduleDeepCleanProposal({ ...change, propertyId: params.id }, session.user.id));
  } catch (error) { return failure(error); }
}
