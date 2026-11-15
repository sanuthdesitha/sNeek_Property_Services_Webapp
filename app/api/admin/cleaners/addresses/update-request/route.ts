import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { ADDRESS_UPDATE_MAX, sendAddressUpdateRequests } from "@/lib/workforce/address-update-notice";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ cleanerIds: z.array(z.string().trim().min(1)).min(1).max(ADDRESS_UPDATE_MAX) });

/**
 * Ask cleaners to update their home address (Cleaner home addresses, ADMIN
 * only, as the page). Inbox notice through the notification pipeline, once
 * per cleaner per day; answers each person's outcome. The real signed-in
 * administrator is recorded as the actor (never a tested account).
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose who to ask." }, { status: 400 });
    const actorId = session.impersonation?.actorId ?? session.user.id;
    const outcomes = await sendAddressUpdateRequests({ actorId, cleanerIds: parsed.data.cleanerIds });
    return NextResponse.json({ outcomes });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in again." }, { status: 401 });
    if (message === "FORBIDDEN") return NextResponse.json({ error: "Only administrators can ask about home addresses." }, { status: 403 });
    return NextResponse.json({ error: "The request was not sent." }, { status: 500 });
  }
}
