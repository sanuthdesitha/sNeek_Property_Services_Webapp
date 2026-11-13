/**
 * Server-side reads for the admin job page. Moved out of the page so the page
 * file only composes; the selects are the ones the old eleven-tab page used,
 * plus the cancel record, the invoice id (for "Open invoice"), the property's
 * on-site radius and access text, and read-only links (quote, lost items,
 * urgent stock needs, the latest client message).
 *
 * Linked records from other workspaces are read only when the viewer may open
 * that workspace (ADMIN always; an operations manager per their packs), so a
 * link never leads to a refusal and a blocked category is omitted.
 */
import "server-only";
import { JobTaskSource, Prisma, QaAssignmentStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { listContinuationRequests } from "@/lib/jobs/continuation-requests";
import type { OpsLevels } from "@/lib/rbac/ops-catalog";
import { readUnplannedLaundry, UNPLANNED_LAUNDRY_TEXT } from "@/lib/scheduling-rules/unplanned-laundry";

const JOB_SELECT = {
  id: true, jobNumber: true, updatedAt: true, jobType: true, status: true,
  cancelReason: true, cancelledAt: true, cancelledFromStatus: true,
  cancelledBy: { select: { name: true, email: true, role: true } },
  scheduledDate: true, startTime: true, dueTime: true, endTime: true,
  estimatedHours: true, actualHours: true, fixedPrice: true, invoiceNote: true,
  notes: true, internalNotes: true, cleanSkipStatus: true, completedAt: true,
  gpsCheckInLat: true, gpsCheckInLng: true, gpsCheckInAt: true, gpsCheckInAccuracyM: true,
  gpsCheckOutLat: true, gpsCheckOutLng: true, gpsCheckOutAt: true, gpsDistanceMeters: true,
  gpsCheckInReasonCode: true, gpsCheckInNote: true, gpsCheckInAdjusted: true,
  sameDayCheckin: true, sameDayCheckinTime: true,
  property: {
    select: {
      id: true, name: true, address: true, suburb: true, latitude: true, longitude: true,
      geofenceRadiusM: true, requireNfcCheckIn: true, keyLocation: true, accessNotes: true, accessInfo: true,
      client: { select: { id: true, name: true, email: true, phone: true } },
    },
  },
  reservation: {
    select: {
      uid: true, startDate: true, endDate: true, summary: true, guestName: true, reservationCode: true,
      guestPhone: true, guestEmail: true, guestProfileUrl: true, adults: true, children: true, infants: true,
      locationText: true, checkinAtLocal: true, checkoutAtLocal: true, source: true,
    },
  },
  assignments: {
    where: { removedAt: null },
    orderBy: { isPrimary: "desc" as const },
    select: {
      id: true, isPrimary: true, responseStatus: true, userId: true, payRate: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
    },
  },
  issueTickets: {
    orderBy: { createdAt: "desc" as const },
    take: 8,
    select: { id: true, title: true, caseType: true, severity: true, state: true, status: true, createdAt: true },
  },
  invoiceLines: {
    orderBy: { createdAt: "desc" as const },
    take: 12,
    select: {
      id: true, description: true, lineTotal: true, category: true,
      // paidDate is when the money arrived; paidAt only when it was recorded.
      invoice: {
        select: {
          id: true, invoiceNumber: true, status: true, kind: true, creditedInFullAt: true,
          totalAmount: true, paidDate: true, paidAt: true, sentAt: true,
        },
      },
    },
  },
  qaReviews: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { id: true, score: true, passed: true, notes: true, kind: true, createdAt: true, flags: true, cleanerReportVisible: true },
  },
  report: { select: { clientVisible: true, sentToClient: true } },
  laundryTask: {
    select: {
      id: true, voidedAt: true,
      status: true, pickupDate: true, dropoffDate: true, flagNotes: true, confirmedAt: true,
      pickedUpAt: true, droppedAt: true, noPickupRequired: true, bagWeightKg: true, dropoffCostAud: true,
      receiptImageUrl: true, pickupKeyPhotoUrl: true, dropoffKeyPhotoUrl: true,
      supplier: { select: { name: true } },
      confirmations: {
        orderBy: { createdAt: "asc" as const },
        select: { id: true, laundryReady: true, bagLocation: true, photoUrl: true, notes: true, createdAt: true },
      },
    },
  },
  timeLogs: {
    orderBy: { startedAt: "asc" as const },
    select: {
      id: true, startedAt: true, stoppedAt: true, durationM: true, user: { select: { name: true, email: true } },
      // Where each cleaner was at the start and end of each segment (2026-11).
      startLat: true, startLng: true, startAccuracyM: true, startDistanceM: true, startVerdict: true, startReasonCode: true, startNote: true, startLocationSource: true, startLocationAt: true,
      stopLat: true, stopLng: true, stopAccuracyM: true, stopDistanceM: true, stopLocationAt: true,
    },
  },
  formSubmissions: {
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true, createdAt: true, data: true, laundryReady: true, laundryOutcome: true, bagLocation: true, autoQaScore: true,
      template: { select: { name: true, schema: true } },
      submittedBy: { select: { name: true, email: true } },
      media: {
        orderBy: { createdAt: "asc" as const },
        select: { id: true, fieldId: true, mediaType: true, url: true, s3Key: true, label: true },
      },
      stockTxs: { select: { quantity: true, propertyStock: { select: { itemId: true, item: { select: { name: true } } } } } },
    },
  },
  jobTasks: {
    // CARRY_FORWARD tasks surface on the job they were carried to.
    where: { source: { in: [JobTaskSource.CLIENT, JobTaskSource.ADMIN] } },
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true, title: true, description: true, source: true, approvalStatus: true, executionStatus: true,
      metadata: true, visibleToCleaner: true, completedAt: true, requiresPhoto: true, requiresNote: true, createdAt: true,
      requestedBy: { select: { name: true, email: true } },
      attachments: {
        orderBy: { createdAt: "asc" as const },
        select: { id: true, url: true, s3Key: true, label: true, mediaType: true, kind: true },
      },
      events: { orderBy: { createdAt: "desc" as const }, select: { action: true, note: true } },
    },
  },
} satisfies Prisma.JobSelect;

export async function loadJobPageJob(id: string) {
  return db.job.findUnique({ where: { id }, select: JOB_SELECT }).catch(() => null);
}

export type JobPageJob = NonNullable<Awaited<ReturnType<typeof loadJobPageJob>>>;

/** Property columns a browser never needs (encrypted codes); stripped before the record is serialised. */
const PROPERTY_SECRET_KEYS = ["accessCode", "alarmCode", "accessInfo"] as const;

export type JobPageAccess = {
  levels: OpsLevels | null;
  canReadUrgentStock: boolean;
};

function opsAllows(levels: OpsLevels | null, feature: keyof OpsLevels): boolean {
  return levels === null || levels[feature] !== "off";
}

export const HISTORY_LIMIT = 50;

export async function loadJobPageRelated(job: JobPageJob, access: JobPageAccess) {
  const propertyId = job.property?.id ?? null;
  const clientId = job.property?.client?.id ?? null;
  const [continuations, auditRows, auditCount, fullProperty, qaAssignment, qaEligibleUsers, quote, lostItems, urgentNeeds, messageCount, latestClientMessage] =
    await Promise.all([
      listContinuationRequests({ jobId: job.id }).catch(() => []),
      db.auditLog
        .findMany({
          where: { jobId: job.id },
          orderBy: { createdAt: "desc" },
          take: HISTORY_LIMIT,
          select: { id: true, action: true, entity: true, entityId: true, createdAt: true, user: { select: { name: true, email: true } } },
        })
        .catch(() => null),
      db.auditLog.count({ where: { jobId: job.id } }).catch(() => null),
      propertyId ? db.property.findUnique({ where: { id: propertyId } }).catch(() => null) : Promise.resolve(null),
      db.qaAssignment
        .findFirst({
          where: { jobId: job.id, status: { notIn: [QaAssignmentStatus.CANCELLED, QaAssignmentStatus.COMPLETED] } },
          orderBy: { createdAt: "desc" },
          select: { id: true, status: true, assignedToId: true, earlyStartReason: true, assignedTo: { select: { name: true, email: true } } },
        })
        .catch(() => null),
      // Same roster rule as /api/admin/qa/assignments.
      db.user
        .findMany({
          where: { role: { in: [Role.QA_INSPECTOR, Role.OPS_MANAGER] }, isActive: true },
          select: { id: true, name: true, email: true, role: true },
          orderBy: [{ role: "asc" }, { name: "asc" }, { email: "asc" }],
        })
        .catch(() => []),
      opsAllows(access.levels, "quotes")
        ? db.quote.findFirst({ where: { convertedJobId: job.id }, select: { id: true, status: true } }).catch(() => null)
        : Promise.resolve(null),
      opsAllows(access.levels, "lost-found")
        ? db.lostFoundItem
            .findMany({ where: { jobId: job.id }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, itemName: true, status: true } })
            .catch(() => null)
        : Promise.resolve(null),
      access.canReadUrgentStock
        ? db.urgentStockNeed
            .findMany({ where: { sourceJobId: job.id }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, itemName: true, stage: true, observedCount: true, unit: true } })
            .catch(() => null)
        : Promise.resolve(null),
      clientId ? db.clientMessage.count({ where: { clientId, jobId: job.id } }).catch(() => null) : Promise.resolve(0),
      // A direct read: opening the Messages tab is what marks messages read.
      clientId
        ? db.clientMessage
            .findFirst({ where: { clientId, jobId: job.id, isFromAdmin: false }, orderBy: { createdAt: "desc" }, select: { id: true, body: true, createdAt: true } })
            .catch(() => null)
        : Promise.resolve(null),
    ]);

  // Scheduling rules were unreadable when the cleaner reported laundry: the
  // outcome was saved but the run is not planned yet (retried hourly).
  const laundryNotPlanned = job.laundryTask ? null : await readUnplannedLaundry(db, job.id).catch(() => null);

  const propertyRecord: Record<string, unknown> = fullProperty ? (JSON.parse(JSON.stringify(fullProperty)) as Record<string, unknown>) : {};
  for (const key of PROPERTY_SECRET_KEYS) delete propertyRecord[key];

  return {
    continuations,
    auditRows,
    auditCount,
    propertyRecord,
    qaAssignment,
    qaEligibleUsers,
    quote,
    lostItems,
    urgentNeeds,
    messageCount,
    latestClientMessage,
    laundryNotPlanned: laundryNotPlanned ? UNPLANNED_LAUNDRY_TEXT : null,
    links: {
      quotes: opsAllows(access.levels, "quotes"),
      lostFound: opsAllows(access.levels, "lost-found"),
      urgentStock: access.canReadUrgentStock,
      cases: opsAllows(access.levels, "cases"),
    },
  };
}

export type JobPageRelated = Awaited<ReturnType<typeof loadJobPageRelated>>;

export async function loadUserNames(ids: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return new Map();
  const users = await db.user
    .findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true } })
    .catch(() => []);
  return new Map(users.map((user) => [user.id, user.name ?? user.email ?? user.id] as const));
}
