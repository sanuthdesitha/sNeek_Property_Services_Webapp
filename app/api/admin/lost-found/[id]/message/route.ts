import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { emailFromContact, phoneFromContact } from "@/lib/lost-found/guest";
import { draftLostFoundMessage, PIPELINE_UNSUPPORTED_REASON, type MessageAudience } from "@/lib/lost-found/message";
import { hydrateItems } from "@/lib/lost-found/service";

/**
 * GET ?audience=guest|client — a draft message for the office to edit, the
 * recipient's contact details, and whether the app can send it. It cannot:
 * the notification pipeline has no guest or lost-and-found client recipient
 * (see lib/lost-found/message.ts), so `send.available` is false with the reason
 * and the office uses its own email or SMS app, then records what it did.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
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
    return NextResponse.json({ audience, draft, recipient, send: { available: false, reason: PIPELINE_UNSUPPORTED_REASON } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not prepare the message.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
