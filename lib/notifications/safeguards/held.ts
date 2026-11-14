import "server-only";
/**
 * Sending safeguards: messages held over quiet hours. Each held row is
 * claimed once (HELD -> RELEASED, conditional update) and sent once through
 * its own transport after quiet hours end; the release passes the gate again,
 * so an identical message already sent is still dropped, a paused type stays
 * paused and the person's preferences are re-checked. A held message older
 * than HOLD_MAX_HOURS is no longer relevant and is recorded as not sent
 * (HELD_EXPIRED); the inbox copy is unaffected.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendEmailDetailed } from "../email";
import { sendSmsDetailed } from "../sms";
import type { HeldPayload } from "./gate";

export const HOLD_MAX_HOURS = 12;
const RELEASE_BATCH = 50;

function isHeldPayload(value: unknown): value is HeldPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  if (payload.transport === "EMAIL") return typeof payload.to === "string" && typeof payload.subject === "string" && typeof payload.html === "string";
  if (payload.transport === "SMS") return typeof payload.to === "string" && typeof payload.body === "string";
  return false;
}

export async function expireHeldMessages(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - HOLD_MAX_HOURS * 3_600_000);
  const result = await db.outboundMessageEvent.updateMany({
    where: { decision: "HELD", createdAt: { lt: cutoff } },
    data: { decision: "SUPPRESSED", reason: "HELD_EXPIRED", heldPayload: Prisma.DbNull },
  });
  return result.count;
}

/** Send held messages once. `inQuietHours` is decided by the caller (organisation timezone). */
export async function releaseHeldMessages(inQuietHours: boolean, now = new Date()): Promise<{ released: number; skipped: number }> {
  if (inQuietHours) return { released: 0, skipped: 0 };
  const rows = await db.outboundMessageEvent.findMany({
    where: { decision: "HELD", createdAt: { gte: new Date(now.getTime() - HOLD_MAX_HOURS * 3_600_000) } },
    orderBy: { createdAt: "asc" },
    take: RELEASE_BATCH,
    select: { id: true, heldPayload: true, typeKey: true, entityKey: true, recipientUserId: true },
  });
  let released = 0;
  let skipped = 0;
  for (const row of rows) {
    const claimed = await db.outboundMessageEvent.updateMany({ where: { id: row.id, decision: "HELD" }, data: { decision: "RELEASED", releasedAt: now } });
    if (claimed.count !== 1) continue;
    if (!isHeldPayload(row.heldPayload)) {
      await db.outboundMessageEvent.update({ where: { id: row.id }, data: { decision: "SUPPRESSED", reason: "HELD_EXPIRED" } });
      skipped += 1;
      continue;
    }
    const meta = { typeKey: row.typeKey, entityKey: row.entityKey, recipientUserId: row.recipientUserId, releasedFromHold: true };
    const payload = row.heldPayload;
    try {
      if (payload.transport === "EMAIL") {
        await sendEmailDetailed({
          to: payload.to, subject: payload.subject, html: payload.html, replyTo: payload.replyTo, from: payload.from,
          transactional: payload.transactional, kind: payload.kind as Parameters<typeof sendEmailDetailed>[0]["kind"], safeguard: meta,
        });
      } else {
        await sendSmsDetailed(payload.to, payload.body, undefined, meta);
      }
      released += 1;
    } catch (error) {
      // The release is never retried automatically: the provider may have taken it.
      logger.error({ err: error, eventId: row.id }, "[safeguards] held message release failed");
    }
    await db.outboundMessageEvent.update({ where: { id: row.id }, data: { heldPayload: Prisma.DbNull } }).catch(() => undefined);
  }
  return { released, skipped };
}
