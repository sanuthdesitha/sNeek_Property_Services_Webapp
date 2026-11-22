import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { buildClientSwitchesView, buildUserSwitchesView } from "@/lib/notifications/personal/view";
import { applySwitchChanges, type SwitchSubjectRef } from "@/lib/notifications/personal/write";
import { SWITCH_HEADERS, readOnlyWhileTestingAs, switchesErrorResponse, switchesSaveSchema } from "@/lib/notifications/personal/route-support";

export const dynamic = "force-dynamic";

/**
 * One person's (`?userId=`) or client account's (`?clientId=`) notification
 * switches — exactly what they see on their own screen, with who changed
 * each switch and when.
 *
 * GET: ADMIN, and OPS_MANAGER with the Messages & notifications pack (the
 * shared middleware gates /api/admin/notifications/** by that pack) — read only.
 * PATCH: ADMIN only, never while testing as someone else; stamped and audited
 * with the administrator as the actor. ADMIN and OPS_MANAGER are deliberately
 * not interchangeable here: changing what someone receives is an
 * administrator's decision.
 */
function subjectFrom(request: NextRequest): SwitchSubjectRef | null {
  const userId = request.nextUrl.searchParams.get("userId")?.trim();
  const clientId = request.nextUrl.searchParams.get("clientId")?.trim();
  if (userId && !clientId) return { kind: "USER", id: userId };
  if (clientId && !userId) return { kind: "CLIENT", id: clientId };
  return null;
}

function editAccess(role: string, impersonating: boolean) {
  if (impersonating) return { canEdit: false, readOnlyReason: readOnlyWhileTestingAs() };
  if (role !== Role.ADMIN) return { canEdit: false, readOnlyReason: "Only an administrator can change someone else's notification switches." };
  return { canEdit: true, readOnlyReason: null };
}

async function viewFor(subject: SwitchSubjectRef, access: { canEdit: boolean; readOnlyReason: string | null }) {
  return subject.kind === "CLIENT" ? buildClientSwitchesView(subject.id, access) : buildUserSwitchesView(subject.id, access);
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const subject = subjectFrom(request);
    if (!subject) return NextResponse.json({ error: "Name one person (userId) or one client (clientId)." }, { status: 400, headers: SWITCH_HEADERS });
    const view = await viewFor(subject, editAccess(String(session.user.role), Boolean(session.impersonation)));
    if (!view) return NextResponse.json({ error: "That person or client was not found." }, { status: 404, headers: SWITCH_HEADERS });
    return NextResponse.json(view, { headers: SWITCH_HEADERS });
  } catch (error) {
    return switchesErrorResponse(error, null, "The notification switches could not be loaded.");
  }
}

export async function PATCH(request: NextRequest) {
  const subject = subjectFrom(request);
  try {
    const session = await requireRole([Role.ADMIN]);
    if (session.impersonation) {
      return NextResponse.json({ error: readOnlyWhileTestingAs(), code: "ACTUAL_ACTOR_REQUIRED" }, { status: 403, headers: SWITCH_HEADERS });
    }
    if (!subject) return NextResponse.json({ error: "Name one person (userId) or one client (clientId)." }, { status: 400, headers: SWITCH_HEADERS });
    const body = switchesSaveSchema.parse(await request.json());
    await applySwitchChanges({
      subject,
      actor: { id: session.user.id, name: session.user.name ?? null, role: String(session.user.role) },
      expectedRevision: body.revision,
      changes: body.changes,
    });
    return NextResponse.json(await viewFor(subject, { canEdit: true, readOnlyReason: null }), { headers: SWITCH_HEADERS });
  } catch (error) {
    const current = subject ? await viewFor(subject, { canEdit: true, readOnlyReason: null }).catch(() => null) : null;
    return switchesErrorResponse(error, current, "The change was not saved. Try again.");
  }
}
