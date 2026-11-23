import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { attachOneOffSiteToClient } from "@/lib/properties/one-off-client";

const schema = z.object({
  clientId: z.string().trim().min(1, "Choose a client.").max(200),
  expectedUpdatedAt: z.string().trim().max(40).nullable().optional(),
});

/**
 * POST { clientId, expectedUpdatedAt } — attach a one-off site that is still
 * under "Unassigned / One-off Jobs" (and every job at it) to its real client.
 * Same roles as editing a property (ADMIN, or OPS_MANAGER with the properties
 * pack through middleware). Rules: lib/properties/one-off-client-rules.ts.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a client." }, { status: 400 });
    const result = await attachOneOffSiteToClient({
      propertyId: params.id,
      clientId: parsed.data.clientId,
      expectedUpdatedAt: parsed.data.expectedUpdatedAt ?? null,
      actor: {
        actualUserId: session.impersonation?.actorId ?? session.user.id,
        effectiveRole: String(session.user.role),
        impersonatedSubjectId: session.impersonation ? session.user.id : null,
      },
    });
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.status });
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "The client could not be attached.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: status === 400 ? "The client could not be attached. Nothing was changed." : message }, { status });
  }
}
