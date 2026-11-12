import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { emailFromContact, phoneFromContact } from "@/lib/lost-found/guest";
import { CLIENT_SEND_NOTE, draftLostFoundMessage, GUEST_SEND_NOTE, type MessageAudience } from "@/lib/lost-found/message";
import { officeSendDecision } from "@/lib/notifications/office-send-permission";
import { resolveClientNoticeTarget } from "@/lib/lost-found/client-notice";
import { OfficeActionError } from "@/lib/notifications/office-actions";
import { hydrateItems } from "@/lib/lost-found/service";

/**
 * GET ?audience=guest|client — a draft message for the office to edit, the
 * recipient's contact details, and whether the app can send it:
 *  - guest: through the notification system's guest-message action;
 *  - client: through the pipeline's client notice to the property client's
 *    active logins (the client's notification switch and the other refusals
 *    are checked here so the dialog says why it cannot send).
 * Both: ADMIN, or OPS_MANAGER with the Lost & found pack at manage, not while
 * impersonating (`office-send-rules.ts`; the send routes re-check).
 * Copy and "record what you did" are offered to every role either way.
 */
async function clientSendState(itemId: string): Promise<{ available: boolean; reason: string; logins?: number }> {
  try {
    const target = await resolveClientNoticeTarget(itemId);
    return { available: true, reason: CLIENT_SEND_NOTE, logins: target.recipients.length };
  } catch (error) {
    if (error instanceof OfficeActionError) return { available: false, reason: `${error.message} Copy the message instead and record what you did.` };
    throw error;
  }
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const audience: MessageAudience = req.nextUrl.searchParams.get("audience") === "client" ? "client" : "guest";
    const item = await db.lostFoundItem.findUnique({ where: { id: params.id } });
    if (!item) return NextResponse.json({ error: "Item not found." }, { status: 404 });
    const [row] = await hydrateItems([item]);
    const settings = await getAppSettings();
    const property = item.propertyId ? await db.property.findUnique({ where: { id: item.propertyId }, select: { name: true, client: { select: { name: true, email: true, phone: true } } } }) : null;
    const draft = draftLostFoundMessage({
      audience,
      itemName: row.itemName,
      foundAt: row.createdAt,
      foundLocation: row.foundLocation,
      propertyName: property?.name ?? row.propertyName,
      propertyAddress: row.propertyAddress,
      guestName: row.guestName,
      clientName: property?.client?.name ?? null,
      officeName: settings.companyName,
      officePhone: settings.companyPhone || null,
      timeZone: settings.timezone || "Australia/Sydney",
    });
    const recipient = audience === "guest"
      ? { name: row.guestName, email: row.guestEmail ?? emailFromContact(row.guestContact), phone: phoneFromContact(row.guestContact) }
      : { name: property?.client?.name ?? null, email: property?.client?.email?.trim() || null, phone: phoneFromContact(property?.client?.phone ?? null) };
    const decision = await officeSendDecision(session, audience === "guest" ? "guest_message" : "lost_item_client_notice");
    const send = !decision.allowed
      ? { available: false, reason: decision.reason }
      : audience === "guest"
        ? { available: true, reason: GUEST_SEND_NOTE }
        : await clientSendState(item.id);
    return NextResponse.json({ audience, draft, recipient, send });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not prepare the message.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
