import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveRouteRole } from "@/lib/auth/route-role";
import { qaAssignmentOwnerWhere } from "@/lib/qa/ownership";
import { explainFlag } from "@/lib/assistant/explain-and-draft";
import { ASSISTANT_HEADERS, assistantFailure, requireAssistantUser } from "@/lib/assistant/http";

export const dynamic = "force-dynamic";
const bodySchema = z.object({ kind: z.enum(["finding", "photo", "integrity"]), id: z.string().min(1).max(300) }).strict();

/** "Explain this flag": plain words from the stored finding only. Same access as photo review. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const roles = [Role.ADMIN, Role.OPS_MANAGER, Role.QA_INSPECTOR];
    const session = await requireAssistantUser(roles);
    if (resolveRouteRole(session.user, roles) === Role.QA_INSPECTOR) {
      const assigned = await db.qaAssignment.findFirst({ where: { jobId: params.id, status: { not: "CANCELLED" }, ...qaAssignmentOwnerWhere(session.user.id) }, select: { id: true } });
      if (!assigned) return NextResponse.json({ error: "Your access does not include this job." }, { status: 403, headers: ASSISTANT_HEADERS });
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: ASSISTANT_HEADERS });
    return NextResponse.json(await explainFlag({ jobId: params.id, kind: parsed.data.kind, id: parsed.data.id, actor: { kind: "user", userId: session.user.id } }), { headers: ASSISTANT_HEADERS });
  } catch (error) { return assistantFailure(error, "No explanation could be made right now."); }
}
