import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { LOCATION_NOTICE_VERSION, type NoticePortal } from "./notice";

type Reader = Prisma.TransactionClient | typeof db;

/** Has this person acknowledged the CURRENT version of the notice for this portal? */
export async function hasAcknowledgedLocationNotice(userId: string, portal: NoticePortal, reader: Reader = db): Promise<boolean> {
  const row = await reader.locationTrackingNotice.findUnique({
    where: { userId_version_portal: { userId, version: LOCATION_NOTICE_VERSION, portal } },
    select: { id: true },
  });
  return Boolean(row);
}

/** Record the acknowledgement (idempotent: a second tap keeps the first time). */
export async function acknowledgeLocationNotice(userId: string, portal: NoticePortal, userAgent: string | null): Promise<{ acknowledgedAt: Date }> {
  const row = await db.locationTrackingNotice.upsert({
    where: { userId_version_portal: { userId, version: LOCATION_NOTICE_VERSION, portal } },
    create: { userId, version: LOCATION_NOTICE_VERSION, portal, userAgent: userAgent?.slice(0, 400) ?? null },
    update: {},
    select: { acknowledgedAt: true },
  });
  return row;
}

/** The error a start route answers when the notice is not acknowledged. */
export const LOCATION_NOTICE_REQUIRED = {
  error: "LOCATION_NOTICE_REQUIRED",
  message: "Read and accept how your location is used before you start.",
  version: LOCATION_NOTICE_VERSION,
} as const;
