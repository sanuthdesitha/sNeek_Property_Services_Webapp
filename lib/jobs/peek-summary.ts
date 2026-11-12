import "server-only";
import { db } from "@/lib/db";
import { buildGuestSummary, telHref } from "./guest-summary";
import { parseJobInternalNotes } from "./meta";
import { withListExtras, type JobListCharge } from "./list-row-extras";
import type { JobPeekSummary } from "./peek-types";

/**
 * The Jobs peek panel's Summary: one slim read instead of the job detail
 * route's full payload (submissions, media, time logs). Guests follow the
 * established rule: `Job.reservation` is the DEPARTING guest (the booking whose
 * checkout created the turnover); the ARRIVING guest is
 * `jobMeta.reservationContext` read through `buildGuestSummary`.
 */
export async function loadJobPeekSummary(jobId: string): Promise<JobPeekSummary | null> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true, jobNumber: true, status: true, jobType: true, scheduledDate: true, startTime: true, endTime: true,
      dueTime: true, cleanSkipStatus: true, propertyId: true, fixedPrice: true, internalNotes: true, sameDayCheckin: true,
      property: { select: { id: true, name: true, suburb: true, client: { select: { id: true, name: true } } } },
      reservation: { select: { guestName: true, guestPhone: true, checkoutAtLocal: true, endDate: true } },
      laundryTask: { select: { status: true, pickupDate: true, dropoffDate: true, noPickupRequired: true, pickedUpAt: true, droppedAt: true } },
      assignments: {
        where: { removedAt: null },
        orderBy: { isPrimary: "desc" },
        select: { userId: true, isPrimary: true, responseStatus: true, user: { select: { name: true, email: true } } },
      },
      qaAssignments: {
        where: { status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, assignedTo: { select: { name: true, email: true } } },
      },
    },
  });
  if (!job) return null;

  const [withCharge] = await withListExtras([job]);
  const charge: JobListCharge = withCharge.charge;
  const arriving = buildGuestSummary(parseJobInternalNotes(job.internalNotes).reservationContext);
  const departing = job.reservation;
  const qa = job.qaAssignments[0];

  return {
    id: job.id,
    jobNumber: job.jobNumber,
    status: job.status,
    jobType: job.jobType,
    scheduledDate: job.scheduledDate.toISOString(),
    startTime: job.startTime,
    endTime: job.endTime,
    dueTime: job.dueTime,
    cleanSkipStatus: job.cleanSkipStatus,
    property: { id: job.property.id, name: job.property.name, suburb: job.property.suburb ?? null },
    client: job.property.client ? { id: job.property.client.id, name: job.property.client.name } : null,
    departing: departing
      ? {
          name: departing.guestName?.trim() || null,
          phoneLabel: departing.guestPhone?.trim() || null,
          phoneHref: telHref(departing.guestPhone),
          checkoutAt: (departing.checkoutAtLocal ?? departing.endDate)?.toISOString() ?? null,
        }
      : null,
    arriving: arriving.hasAnything
      ? { name: arriving.name, checkinAt: arriving.checkinAtLocal, guestCountLabel: arriving.guestCountLabel, sameDay: job.sameDayCheckin }
      : job.sameDayCheckin ? { name: null, checkinAt: null, guestCountLabel: null, sameDay: true } : null,
    laundry: job.laundryTask
      ? {
          status: job.laundryTask.status,
          noPickupRequired: job.laundryTask.noPickupRequired,
          pickupDate: job.laundryTask.pickupDate.toISOString().slice(0, 10),
          dropoffDate: job.laundryTask.dropoffDate.toISOString().slice(0, 10),
          pickedUpAt: job.laundryTask.pickedUpAt?.toISOString() ?? null,
          droppedAt: job.laundryTask.droppedAt?.toISOString() ?? null,
        }
      : null,
    charge,
    assignments: job.assignments.map((row) => ({
      userId: row.userId,
      name: row.user.name?.trim() || row.user.email || "Cleaner",
      isPrimary: row.isPrimary,
      responseStatus: String(row.responseStatus),
    })),
    qa: qa ? { status: String(qa.status), inspector: qa.assignedTo?.name ?? qa.assignedTo?.email ?? null } : null,
  };
}
