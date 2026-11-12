import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { OfficeSendDenied, requireOfficeSend } from "@/lib/notifications/office-send-permission";
import { db } from "@/lib/db";
import { OfficeActionError } from "@/lib/notifications/office-actions";
import { sendLostItemClientNotice } from "@/lib/lost-found/client-notice";
import { hydrateItemWithEvents } from "@/lib/lost-found/service";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * POST — "Tell client" sent from the app (catalog `lostfound.client_notice`):
 * ADMIN, or OPS_MANAGER with the Lost & found pack at manage (owner decision
 * 2026-11-12; others copy the draft and record what they did), never while
 * impersonating. The body
 * names the transports; the item's timeline records the real states.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { actor } = await requireOfficeSend("lost_item_client_notice");
    const body = (await req.json()) as Record<string, unknown>;
    const result = await sendLostItemClientNotice(actor.id, { ...body, lostFoundItemId: params.id }, actor.role);
    const [item, events] = await Promise.all([
      db.lostFoundItem.findUniqueOrThrow({ where: { id: params.id } }),
      db.lostFoundEvent.findMany({ where: { itemId: params.id }, orderBy: { createdAt: "asc" } }),
    ]);
    return NextResponse.json({ result, item: await hydrateItemWithEvents(item, events) }, { headers });
  } catch (error) {
    if (error instanceof OfficeSendDenied) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof OfficeActionError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Check the message and the transports." }, { status: 400, headers });
    const message = error instanceof Error ? error.message : "The message could not be sent.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "The message could not be sent." : message }, { status, headers });
  }
}
