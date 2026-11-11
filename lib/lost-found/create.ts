/**
 * Creating a lost and found item — one path for the reporting cleaner and the
 * office. When the item is logged against a job, the job's DEPARTING booking
 * guest is copied onto the item (lib/lost-found/guest.ts) in the same
 * transaction, and a separate system timeline entry records it. That entry is
 * not the reporter's, so the cleaner's redacted view never shows guest data.
 */
import type { LostFoundItem, LostFoundStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { guestFieldsFromBooking } from "./guest";
import type { LostFoundPhoto } from "./service";

export type CreateLostFoundItemInput = {
  actorId: string;
  propertyId: string;
  jobId: string | null;
  itemName: string;
  location: string | null;
  notes: string | null;
  /** Already ownership-checked, with links derived from their keys. */
  photos: LostFoundPhoto[];
  /** Stored on the REPORTED entry so the timeline says who logged it from where. */
  loggedBy: "CLEANER" | "OFFICE";
};

const BOOKING_SELECT = { id: true, guestName: true, guestPhone: true, guestEmail: true, reservationCode: true } as const;

export async function createLostFoundItem(input: CreateLostFoundItemInput): Promise<LostFoundItem> {
  return db.$transaction(async (tx) => {
    const job = input.jobId
      ? await tx.job.findUnique({ where: { id: input.jobId }, select: { id: true, propertyId: true, reservation: { select: BOOKING_SELECT } } })
      : null;
    if (input.jobId && (!job || job.propertyId !== input.propertyId)) throw new Error("The job is not at this property.");
    const guest = guestFieldsFromBooking(job?.reservation ?? null);
    const reportedMeta: Prisma.InputJsonValue = {
      foundLocation: input.location,
      photoCount: input.photos.length,
      ...(input.loggedBy === "OFFICE" ? { loggedBy: "OFFICE" } : {}),
    };
    // Explicit times keep "logged" before "guest added" on the timeline.
    const loggedAt = new Date();
    const item = await tx.lostFoundItem.create({
      data: {
        jobId: input.jobId,
        propertyId: input.propertyId,
        reportedByUserId: input.actorId,
        itemName: input.itemName,
        description: input.notes,
        foundLocation: input.location,
        photos: input.photos as unknown as Prisma.InputJsonValue,
        status: "REPORTED" as LostFoundStatus,
        ...(guest ?? {}),
        createdAt: loggedAt,
        events: { create: { userId: input.actorId, action: "REPORTED", note: input.notes, meta: reportedMeta, createdAt: loggedAt } },
      },
    });
    if (guest && job?.reservation) {
      const code = job.reservation.reservationCode?.trim();
      const copied = (["guestName", "guestContact", "guestEmail"] as const).filter((field) => guest[field] !== null);
      await tx.lostFoundEvent.create({
        data: {
          itemId: item.id,
          userId: null,
          action: "GUEST_IMPORTED",
          note: copied.length
            ? `Guest details added from booking${code ? ` ${code}` : ""}.`
            : `Linked to booking${code ? ` ${code}` : ""}; the booking has no guest name, phone or email.`,
          meta: { reservationId: job.reservation.id, reservationCode: code ?? null, copied: [...copied] },
          createdAt: new Date(loggedAt.getTime() + 1),
        },
      });
    }
    return item;
  });
}
