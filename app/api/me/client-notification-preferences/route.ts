import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { legacyClientChanges, legacyClientPreferenceRow, legacyClientPreferenceSchema } from "@/lib/notifications/personal/legacy-client";
import { applySwitchChanges } from "@/lib/notifications/personal/write";

/**
 * The older client "Service updates" route (classic client profile page),
 * kept compatible. It now writes through the shared switch path, so each
 * change is stamped with who made it, audited and visible to the office
 * (lib/notifications/personal). Refused while testing as someone else.
 */
async function getCurrentClient() {
  const session = await requireSession().catch(() => null);
  if (!session?.user?.id) return null;
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { clientId: true, role: true },
  });
  if (!user || user.role !== "CLIENT" || !user.clientId) return null;
  return { clientId: user.clientId, session };
}

export async function GET() {
  const current = await getCurrentClient();
  if (!current) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(await legacyClientPreferenceRow(current.clientId));
}

export async function PATCH(req: NextRequest) {
  const current = await getCurrentClient();
  if (!current) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (current.session.impersonation) {
    return NextResponse.json({ error: "You are testing as someone else: these switches are read-only.", code: "ACTUAL_ACTOR_REQUIRED" }, { status: 403 });
  }
  const parsed = legacyClientPreferenceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid" }, { status: 400 });
  }
  try {
    await applySwitchChanges({
      subject: { kind: "CLIENT", id: current.clientId },
      actor: { id: current.session.user.id, name: current.session.user.name ?? null, role: String(current.session.user.role) },
      expectedRevision: null,
      changes: legacyClientChanges(parsed.data),
    });
  } catch {
    return NextResponse.json({ error: "Your change was not saved. Try again." }, { status: 500 });
  }
  return NextResponse.json(await legacyClientPreferenceRow(current.clientId));
}
