/**
 * Client self-serve bookings, as REQUESTS rather than jobs.
 *
 * A client booking used to create a Job the moment they tapped submit. Nobody
 * had agreed to it, nobody had checked whether a cleaner was free that day, and
 * it appeared on the jobs board indistinguishable from work the office had
 * actually scheduled. The failure is quiet and late: the job sits UNASSIGNED
 * until someone notices, or worse it gets assigned on the day to whoever is
 * left.
 *
 * The request now lives on the QuoteLead the flow ALREADY created — status NEW
 * plus `structuredContext.createdVia === "client_booking"`. No new table and no
 * migration: a lead is already "someone wants work done, we have not committed
 * yet", and CONVERTED already means "this became a job", which is exactly the
 * transition an approval is. Declining marks it LOST.
 *
 * Deliberately NOT a new JobStatus. Statuses are read by dozens of lists,
 * filters and aggregates across the admin, cleaner and client portals, and this
 * codebase has repeatedly shipped a status that several of those lists never
 * learned about (EN_ROUTE most recently). A booking with no job cannot be
 * missed by a job query that does not know about it.
 */

import { JobStatus, LeadStatus, Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { reserveJobNumber } from "@/lib/jobs/job-number";
import { sydneyDateKey, sydneyDayStart, sydneyDayEndInclusive } from "@/lib/time/sydney-range";

/** Marks a QuoteLead as a pending client booking rather than a sales enquiry. */
export const BOOKING_REQUEST_VIA = "client_booking";

/** Job statuses that mean a cleaner's day is already spoken for. */
const OCCUPYING_STATUSES: JobStatus[] = [
  JobStatus.UNASSIGNED,
  JobStatus.OFFERED,
  JobStatus.ASSIGNED,
  JobStatus.EN_ROUTE,
  JobStatus.IN_PROGRESS,
  JobStatus.PAUSED,
  JobStatus.WAITING_CONTINUATION_APPROVAL,
  JobStatus.SUBMITTED,
  JobStatus.QA_REVIEW,
];

export interface BookingRequestContext {
  createdVia?: string;
  propertyId?: string;
  /** Sydney calendar date, yyyy-MM-dd. */
  scheduledDate?: string;
  jobType?: string;
  requestedByUserId?: string;
  /** Set when an admin declines, so the client can be told why. */
  declineReason?: string;
  /** Set on approval so the request points at what it became. */
  approvedJobId?: string;
}

export interface TeamAvailability {
  /** Sydney calendar date the figures describe. */
  dateKey: string;
  activeCleaners: number;
  /** Cleaners already holding at least one job that day. */
  busyCleaners: number;
  /** activeCleaners - busyCleaners, floored at zero. */
  freeCleaners: number;
  /** Jobs already scheduled that day, whoever they belong to. */
  jobsScheduled: number;
  /** Jobs that day with nobody on them yet. */
  unassignedJobs: number;
}

export interface BookingRequest {
  id: string;
  createdAt: Date;
  clientId: string | null;
  clientName: string;
  contactEmail: string;
  notes: string | null;
  jobType: string | null;
  scheduledDate: string | null;
  estimate: number | null;
  property: { id: string; name: string; address: string; suburb: string | null } | null;
}

export function parseBookingContext(value: Prisma.JsonValue | null): BookingRequestContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as BookingRequestContext;
}

/**
 * Cleaner capacity on one Sydney day.
 *
 * "Busy" counts DISTINCT cleaners holding work, not jobs — one cleaner with
 * three cleans is one unavailable person, and counting jobs would make a
 * productive day look like an overbooked one. Assignments removed from a job
 * (removedAt) hold nobody.
 */
export async function getTeamAvailability(dateKey: string): Promise<TeamAvailability> {
  const start = sydneyDayStart(dateKey);
  const end = sydneyDayEndInclusive(dateKey);

  const [activeCleaners, dayJobs] = await Promise.all([
    db.user.count({ where: { role: Role.CLEANER, isActive: true } }),
    db.job.findMany({
      where: {
        scheduledDate: { gte: start, lte: end },
        // There is no CANCELLED status in this schema — a cancelled job is
        // removed — so only finished work is excluded here.
        status: { notIn: [JobStatus.COMPLETED, JobStatus.INVOICED] },
      },
      select: {
        status: true,
        assignments: { where: { removedAt: null }, select: { userId: true } },
      },
    }),
  ]);

  const busy = new Set<string>();
  let unassignedJobs = 0;
  for (const job of dayJobs) {
    if (job.assignments.length === 0) {
      unassignedJobs += 1;
      continue;
    }
    if (OCCUPYING_STATUSES.includes(job.status)) {
      for (const a of job.assignments) busy.add(a.userId);
    }
  }

  return {
    dateKey,
    activeCleaners,
    busyCleaners: busy.size,
    freeCleaners: Math.max(0, activeCleaners - busy.size),
    jobsScheduled: dayJobs.length,
    unassignedJobs,
  };
}

/** Pending client bookings, oldest first — the queue an admin works through. */
export async function listPendingBookingRequests(): Promise<BookingRequest[]> {
  const leads = await db.quoteLead.findMany({
    // The createdVia discriminator lives inside a Json column, so it is applied
    // below rather than in the query; status NEW already keeps this small.
    where: { status: LeadStatus.NEW },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: {
      id: true,
      createdAt: true,
      clientId: true,
      name: true,
      email: true,
      notes: true,
      estimateMin: true,
      structuredContext: true,
      client: { select: { name: true } },
    },
  });

  const bookings = leads
    .map((lead) => ({ lead, ctx: parseBookingContext(lead.structuredContext) }))
    .filter(({ ctx }) => ctx.createdVia === BOOKING_REQUEST_VIA);

  const propertyIds = bookings
    .map(({ ctx }) => ctx.propertyId)
    .filter((id): id is string => typeof id === "string");

  const properties =
    propertyIds.length === 0
      ? []
      : await db.property.findMany({
          where: { id: { in: propertyIds } },
          select: { id: true, name: true, address: true, suburb: true },
        });
  const propertyById = new Map(properties.map((p) => [p.id, p]));

  return bookings.map(({ lead, ctx }) => ({
    id: lead.id,
    createdAt: lead.createdAt,
    clientId: lead.clientId,
    clientName: lead.client?.name ?? lead.name,
    contactEmail: lead.email,
    notes: lead.notes,
    jobType: ctx.jobType ?? null,
    scheduledDate: ctx.scheduledDate ?? null,
    estimate: lead.estimateMin ?? null,
    property: ctx.propertyId ? propertyById.get(ctx.propertyId) ?? null : null,
  }));
}

export class BookingRequestError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "ALREADY_DECIDED" | "INVALID"
  ) {
    super(message);
    this.name = "BookingRequestError";
  }
}

/**
 * Approve a request: this is where the Job is finally created.
 *
 * The status flip and the job creation share one transaction, and the flip is
 * guarded on `status: NEW`. Two admins clicking approve at the same moment
 * would otherwise create two jobs for one booking — the second update matches
 * no row and rolls the whole thing back instead.
 */
export async function approveBookingRequest(input: {
  requestId: string;
  adminUserId: string;
  /** Overrides the client's requested date. Sydney yyyy-MM-dd. */
  scheduledDate?: string;
}): Promise<{ jobId: string; jobNumber: string; scheduledDate: string }> {
  const lead = await db.quoteLead.findUnique({
    where: { id: input.requestId },
    select: { id: true, status: true, notes: true, structuredContext: true },
  });
  if (!lead) throw new BookingRequestError("That booking request no longer exists.", "NOT_FOUND");

  const ctx = parseBookingContext(lead.structuredContext);
  if (ctx.createdVia !== BOOKING_REQUEST_VIA) {
    throw new BookingRequestError("That record is not a client booking request.", "INVALID");
  }
  if (lead.status !== LeadStatus.NEW) {
    throw new BookingRequestError(
      "That booking request has already been decided.",
      "ALREADY_DECIDED"
    );
  }

  const scheduledDate = input.scheduledDate ?? ctx.scheduledDate;
  if (!scheduledDate || !ctx.propertyId || !ctx.jobType) {
    throw new BookingRequestError("That booking request is missing its details.", "INVALID");
  }

  const property = await db.property.findUnique({
    where: { id: ctx.propertyId },
    select: { id: true },
  });
  if (!property) {
    throw new BookingRequestError("The property on this request no longer exists.", "NOT_FOUND");
  }

  return db.$transaction(async (tx) => {
    // Guarded flip FIRST: if another admin already approved this, updateMany
    // matches nothing and we abort before a duplicate job exists.
    const claimed = await tx.quoteLead.updateMany({
      where: { id: lead.id, status: LeadStatus.NEW },
      data: { status: LeadStatus.CONVERTED },
    });
    if (claimed.count === 0) {
      throw new BookingRequestError(
        "That booking request has already been decided.",
        "ALREADY_DECIDED"
      );
    }

    const jobNumber = await reserveJobNumber(tx);
    const job = await tx.job.create({
      data: {
        jobNumber,
        propertyId: ctx.propertyId as string,
        jobType: ctx.jobType as any,
        status: JobStatus.UNASSIGNED,
        scheduledDate: sydneyDayStart(scheduledDate),
        notes: lead.notes || undefined,
      },
      select: { id: true, jobNumber: true },
    });

    await tx.quoteLead.update({
      where: { id: lead.id },
      data: { structuredContext: { ...ctx, scheduledDate, approvedJobId: job.id } as any },
    });

    await tx.auditLog.create({
      data: {
        userId: input.adminUserId,
        jobId: job.id,
        action: "CLIENT_BOOKING_APPROVED",
        entity: "QuoteLead",
        entityId: lead.id,
        after: {
          jobId: job.id,
          jobNumber: job.jobNumber,
          scheduledDate,
          // Recorded because moving the client's date is a decision they will
          // notice, and "why is my clean on Thursday" needs an answer.
          movedFromRequestedDate: ctx.scheduledDate !== scheduledDate,
        } as any,
      },
    });

    return { jobId: job.id, jobNumber: job.jobNumber, scheduledDate };
  });
}

/** Decline a request. No job is created; the reason is kept for the client. */
export async function declineBookingRequest(input: {
  requestId: string;
  adminUserId: string;
  reason?: string;
}): Promise<void> {
  const lead = await db.quoteLead.findUnique({
    where: { id: input.requestId },
    select: { id: true, status: true, structuredContext: true },
  });
  if (!lead) throw new BookingRequestError("That booking request no longer exists.", "NOT_FOUND");

  const ctx = parseBookingContext(lead.structuredContext);
  if (ctx.createdVia !== BOOKING_REQUEST_VIA) {
    throw new BookingRequestError("That record is not a client booking request.", "INVALID");
  }
  if (lead.status !== LeadStatus.NEW) {
    throw new BookingRequestError(
      "That booking request has already been decided.",
      "ALREADY_DECIDED"
    );
  }

  const claimed = await db.quoteLead.updateMany({
    where: { id: lead.id, status: LeadStatus.NEW },
    data: {
      status: LeadStatus.LOST,
      structuredContext: { ...ctx, declineReason: input.reason?.trim() || undefined } as any,
    },
  });
  if (claimed.count === 0) {
    throw new BookingRequestError(
      "That booking request has already been decided.",
      "ALREADY_DECIDED"
    );
  }

  await db.auditLog.create({
    data: {
      userId: input.adminUserId,
      action: "CLIENT_BOOKING_DECLINED",
      entity: "QuoteLead",
      entityId: lead.id,
      after: { reason: input.reason ?? null } as any,
    },
  });
}

/** Today's Sydney date key, for defaulting an availability lookup. */
export function bookingDateKey(date: Date): string {
  return sydneyDateKey(date);
}
