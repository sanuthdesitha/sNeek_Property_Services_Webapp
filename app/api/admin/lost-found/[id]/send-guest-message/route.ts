import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z, ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { GuestMessageError, sendGuestMessage, type GuestMessageResult } from "@/lib/notifications/guest-message";
import { LostFoundRuleError, recordLostFoundWorkflow } from "@/lib/lost-found/mutations";
import { guestSendOutcome } from "@/lib/lost-found/message";
import { hydrateItemWithEvents } from "@/lib/lost-found/service";

const bodySchema = z.object({
  transport: z.enum(["EMAIL", "SMS"]),
  to: z.string().trim().min(3).max(200),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(1000),
  idempotencyKey: z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9:_-]+$/),
}).strict();

/**
 * POST — "Message guest" sent from the app, through the notification system's
 * guest message action (catalog `guest.message`: ADMIN only, explicit email or
 * SMS transport, rate-limited, audited, one send per idempotency key). A guest
 * has no account, so the durable intent pipeline cannot carry it; this is the
 * notification system's own path for guests, not a separate sender.
 *
 * The item moves to Guest contacted ONLY when the provider accepted the
 * message, and the timeline says "accepted, delivery not confirmed". A skipped
 * or failed send is recorded as not sent and changes nothing else.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    if (session.impersonation) return NextResponse.json({ error: "Messages cannot be sent while impersonating." }, { status: 403 });
    const body = bodySchema.parse(await req.json());
    const result: GuestMessageResult = await sendGuestMessage(session.user.id, { lostFoundItemId: params.id, ...body });
    const outcome = guestSendOutcome(body.transport, result);
    if (outcome.accepted) {
      try {
        await recordLostFoundWorkflow(params.id, session.user.id, { action: "GUEST_CONTACTED", channel: body.transport === "EMAIL" ? "EMAIL" : "SMS", sentByApp: true, note: `${outcome.note}\n\nMessage sent:\n${body.body}` });
      } catch (error) {
        // A closed item: the message went, but the status is not moved.
        if (!(error instanceof LostFoundRuleError)) throw error;
        await db.lostFoundEvent.create({ data: { itemId: params.id, userId: session.user.id, action: "COMMENT", note: `${outcome.note} The item is closed, so its status was not changed.` } });
      }
    } else if (outcome.recordNotSent) {
      await db.lostFoundEvent.create({ data: { itemId: params.id, userId: session.user.id, action: "MESSAGE_NOT_SENT", note: outcome.note, meta: { transport: body.transport, state: result.state, errorCode: result.errorCode } } });
    }
    const [item, events] = await Promise.all([
      db.lostFoundItem.findUniqueOrThrow({ where: { id: params.id } }),
      db.lostFoundEvent.findMany({ where: { itemId: params.id }, orderBy: { createdAt: "asc" } }),
    ]);
    return NextResponse.json({ outcome, item: await hydrateItemWithEvents(item, events) });
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Check the message, recipient and transport." }, { status: 400 });
    if (error instanceof GuestMessageError) return NextResponse.json({ error: error.message }, { status: error.status });
    const message = error instanceof Error ? error.message : "The message could not be sent.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
