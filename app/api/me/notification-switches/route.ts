import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { buildClientSwitchesView, buildUserSwitchesView } from "@/lib/notifications/personal/view";
import { applySwitchChanges, type SwitchSubjectRef } from "@/lib/notifications/personal/write";
import { SWITCH_HEADERS, readOnlyWhileTestingAs, switchesErrorResponse, switchesSaveSchema } from "@/lib/notifications/personal/route-support";

export const dynamic = "force-dynamic";

/**
 * The signed-in person's OWN notification switches, every portal. A client
 * login sees and changes its client account's switches (they apply to every
 * login of the account and to the client's own email address and phone); any
 * other login its own. The administrator's view of the same person reads and
 * writes the same stores (/api/admin/notifications/switches).
 *
 * Never another person's: no id is accepted. While testing as someone else the
 * switches are shown read-only and a change is refused.
 */
async function ownSubject(userId: string, role: string): Promise<SwitchSubjectRef> {
  if (role === "CLIENT") {
    const user = await db.user.findUnique({ where: { id: userId }, select: { clientId: true } });
    if (user?.clientId) return { kind: "CLIENT", id: user.clientId };
  }
  return { kind: "USER", id: userId };
}

async function viewFor(subject: SwitchSubjectRef, impersonating: boolean) {
  const access = { canEdit: !impersonating, readOnlyReason: impersonating ? readOnlyWhileTestingAs() : null };
  return subject.kind === "CLIENT" ? buildClientSwitchesView(subject.id, access) : buildUserSwitchesView(subject.id, access);
}

export async function GET() {
  try {
    const session = await requireSession();
    const subject = await ownSubject(session.user.id, String(session.user.role));
    const view = await viewFor(subject, Boolean(session.impersonation));
    if (!view) return NextResponse.json({ error: "Your account was not found." }, { status: 404, headers: SWITCH_HEADERS });
    return NextResponse.json(view, { headers: SWITCH_HEADERS });
  } catch (error) {
    return switchesErrorResponse(error, null, "Your notification switches could not be loaded.");
  }
}

export async function PATCH(request: NextRequest) {
  let subject: SwitchSubjectRef | null = null;
  try {
    const session = await requireSession();
    if (session.impersonation) {
      return NextResponse.json({ error: readOnlyWhileTestingAs(), code: "ACTUAL_ACTOR_REQUIRED" }, { status: 403, headers: SWITCH_HEADERS });
    }
    const body = switchesSaveSchema.parse(await request.json());
    subject = await ownSubject(session.user.id, String(session.user.role));
    await applySwitchChanges({
      subject,
      actor: { id: session.user.id, name: session.user.name ?? null, role: String(session.user.role) },
      expectedRevision: body.revision,
      changes: body.changes,
    });
    return NextResponse.json(await viewFor(subject, false), { headers: SWITCH_HEADERS });
  } catch (error) {
    const current = subject ? await viewFor(subject, false).catch(() => null) : null;
    return switchesErrorResponse(error, current, "Your change was not saved. Try again.");
  }
}
