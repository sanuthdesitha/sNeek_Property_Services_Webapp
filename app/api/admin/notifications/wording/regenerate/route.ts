import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { requireWordingEditor } from "@/lib/notifications/wording/permission";
import { regenerateWording } from "@/lib/notifications/wording/regenerate";
import { WORDING_HEADERS, wordingErrorResponse } from "@/lib/notifications/wording/route-support";

/**
 * POST: a wording PROPOSAL from the configured AI provider. Never saved and
 * never sent: the editor shows it beside the current wording. Same access as
 * editing wording. The request is audited (who asked, for which part; the
 * prompt holds no personal data).
 */
export async function POST(request: Request) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const actorRole = await requireWordingEditor(session);
    const body: unknown = await request.json();
    const result = await regenerateWording(body, { kind: "user", userId: session.user.id });
    const target = body as { typeKey?: string; partId?: string; transport?: string };
    await db.auditLog.create({ data: {
      userId: session.user.id, action: "NOTIFICATION_WORDING_PROPOSAL_REQUESTED", entity: "AppSetting", entityId: `notificationWording:${String(target.typeKey ?? "")}`,
      after: { typeKey: target.typeKey ?? null, part: target.partId ?? null, transport: target.transport ?? null, actorRole, accepted: false, outcome: result.ok ? "proposal" : "rejected", reason: result.ok ? null : result.reason },
    } });
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 422, headers: WORDING_HEADERS });
    return NextResponse.json(result, { headers: WORDING_HEADERS });
  } catch (error) {
    return wordingErrorResponse(error, "No suggestion could be made. Nothing was changed.");
  }
}
