import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { transitionCase } from "@/lib/cases/lifecycle";
import { getCaseById } from "@/lib/cases/service";

const CASE_STATES = [
  "OPEN",
  "TRIAGE",
  "ASSIGNED",
  "IN_PROGRESS",
  "AWAITING_CLIENT",
  "RESOLVED",
  "CLOSED",
  "CANCELLED",
] as const;

const bodySchema = z.object({
  toState: z.enum(CASE_STATES),
  reason: z.string().trim().max(4000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const actorId = (session as any).user?.id;
    if (!actorId) {
      return NextResponse.json({ error: "Unauthenticated." }, { status: 401 });
    }
    const body = bodySchema.parse(await req.json().catch(() => ({})));
    await transitionCase({
      caseId: params.id,
      toState: body.toState,
      actorId,
      reason: body.reason,
    });
    const updated = await getCaseById(params.id);
    return NextResponse.json(updated);
  } catch (err: any) {
    const msg = err?.message ?? "Could not transition case.";
    const status =
      msg === "UNAUTHORIZED"
        ? 401
        : msg === "FORBIDDEN"
        ? 403
        : msg.startsWith("Invalid transition")
        ? 400
        : msg.includes("not found")
        ? 404
        : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
