import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";

export class BookingKeyConflict extends Error {
  constructor() { super("This request key belongs to a different booking. Reload the booking page."); }
}

export function bookingIdentity(userId: string, clientId: string, key: string, body: {
  propertyId: string; jobType: string; scheduledDate: string; notes?: string | null;
}) {
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return {
    id: `booking_${hash([userId, key.toLowerCase()])}`,
    fingerprint: hash([clientId, body.propertyId, body.jobType, body.scheduledDate, body.notes?.trim() || null]),
  };
}

export async function findBookingReplay(tx: Prisma.TransactionClient, identity: ReturnType<typeof bookingIdentity>) {
  // The primary-key receipt is the lead itself, so it commits/rolls back with
  // the request. Transaction-scoped locking serializes concurrent retries.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity.id}, 0))`;
  const lead = await tx.quoteLead.findUnique({ where: { id: identity.id }, select: { id: true, structuredContext: true } });
  if (!lead) return null;
  const context = lead.structuredContext;
  if (!context || typeof context !== "object" || Array.isArray(context) ||
      context.bookingFingerprint !== identity.fingerprint) throw new BookingKeyConflict();
  return { id: lead.id };
}
