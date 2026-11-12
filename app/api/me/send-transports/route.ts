import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import {
  SEND_TRANSPORT_KINDS,
  clearTransportChoice,
  readSendTransportPreferences,
} from "@/lib/notifications/send-transport-preference";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

const clearSchema = z.object({ kind: z.enum(SEND_TRANSPORT_KINDS) }).strict();

/**
 * The signed-in office user's own "Don't ask again" transport choices
 * (lib/notifications/send-transport-preference.ts). GET lists them; DELETE
 * { kind } forgets one so the dialog asks again. Only ever the caller's own
 * row; nothing is read or changed while impersonating.
 */
export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation) return NextResponse.json({ impersonating: true, readable: true, kinds: {} }, { headers });
    const preferences = await readSendTransportPreferences(session.user.id);
    return NextResponse.json({ impersonating: false, ...preferences }, { headers });
  } catch (err: unknown) {
    const status = getApiErrorStatus(err, 500);
    return NextResponse.json({ error: status === 500 ? "Could not read your sending choices." : (err as Error).message }, { status, headers });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation) return NextResponse.json({ error: "Sending choices cannot be changed while impersonating." }, { status: 403, headers });
    const parsed = clearSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Say which choice to forget." }, { status: 400, headers });
    const preferences = await clearTransportChoice(session.user.id, parsed.data.kind);
    return NextResponse.json({ impersonating: false, ...preferences }, { headers });
  } catch (err: unknown) {
    const status = getApiErrorStatus(err, 500);
    return NextResponse.json({ error: status === 500 ? "Could not change your sending choices." : (err as Error).message }, { status, headers });
  }
}
