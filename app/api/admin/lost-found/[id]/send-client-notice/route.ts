import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { OfficeActionError } from "@/lib/notifications/office-actions";
import { sendLostItemClientNotice } from "@/lib/lost-found/client-notice";
import { hydrateItemWithEvents } from "@/lib/lost-found/service";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * POST — "Tell client" sent from the app (catalog `lostfound.client_notice`):
 * administrators only (mirrors the guest message; operations managers copy
 * the draft and record what they did), never while impersonating. The body
 * names the transports; the item's timeline records the real states.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    if (session.impersonation) return NextResponse.json({ error: "Messages cannot be sent while impersonating." }, { status: 403, headers });
    const body = (await req.json()) as Record<string, unknown>;
    const result = await sendLostItemClientNotice(session.user.id, { ...body, lostFoundItemId: params.id });
    const [item, events] = await Promise.all([
      db.lostFoundItem.findUniqueOrThrow({ where: { id: params.id } }),
      db.lostFoundEvent.findMany({ where: { itemId: params.id }, orderBy: { createdAt: "asc" } }),
    ]);
    return NextResponse.json({ result, item: await hydrateItemWithEvents(item, events) }, { headers });
  } catch (error) {
    if (error instanceof OfficeActionError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Check the message and the transports." }, { status: 400, headers });
    const message = error instanceof Error ? error.message : "The message could not be sent.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "The message could not be sent." : message }, { status, headers });
  }
}
