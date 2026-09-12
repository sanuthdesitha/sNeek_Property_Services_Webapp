import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { changeInboxState, InboxStateError } from "@/lib/notifications/inbox-state-store";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function PATCH(request: Request) {
  try {
    const session = await requireSession();
    if (session.impersonation) return NextResponse.json({ error: "Follow-up cannot be changed while impersonating." }, { status: 403, headers });
    const state = await changeInboxState(session.user.id, session.user.role, await request.json().catch(() => null));
    return NextResponse.json({ state }, { headers });
  } catch (error) {
    const status = error instanceof InboxStateError ? error.status : getApiErrorStatus(error, 503);
    return NextResponse.json({ error: error instanceof InboxStateError ? error.message : "Could not save follow-up status." }, { status, headers });
  }
}
