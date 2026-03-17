import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { addDays, differenceInCalendarDays, startOfDay } from "date-fns";
import { LaundryFlag, LaundryStatus, Prisma } from "@prisma/client";
import { getAppSettings, type LaundryOperationsSettings } from "@/lib/settings";

type PlannerJob = Prisma.JobGetPayload<{
  include: {
    property: true;
  };
}>;

export type LaundryScenario = "BACK_TO_BACK" | "MICRO_CYCLE" | "COMPRESSED" | "FALLBACK";

export interface LaundryPlanDraftItem {
  jobId: string;
  propertyId: string;
  propertyName: string;
  suburb: string;
  cleanDate: string;
  pickupDate: string;
  dropoffDate: string;
  status: LaundryStatus;
  flagReason: LaundryFlag | null;
  flagNotes: string | null;
  scenario: LaundryScenario;
  linenBufferSets: number;
}

function normalizeDate(value: Date) {
  return startOfDay(value);
}

function serializeDate(value: Date) {
  return normalizeDate(value).toISOString();
}

function capDropoffDate(pickupDate: Date, requestedDropoffDate: Date, maxOutdoorDays: number) {
  const maxAllowed = addDays(pickupDate, maxOutdoorDays);
  return requestedDropoffDate > maxAllowed ? maxAllowed : requestedDropoffDate;
}

async function getNextTurnoverCleanDate(job: PlannerJob) {
  const nextJob = await db.job.findFirst({
    where: {
      propertyId: job.propertyId,
      jobType: "AIRBNB_TURNOVER",
      id: { not: job.id },
      scheduledDate: { gt: normalizeDate(job.scheduledDate) },
      status: { not: "INVOICED" },
    },
    select: { scheduledDate: true },
    orderBy: { scheduledDate: "asc" },
  });
  return nextJob ? normalizeDate(nextJob.scheduledDate) : null;
}

async function computeDraftItem(
  job: PlannerJob,
  operations: LaundryOperationsSettings
): Promise<LaundryPlanDraftItem> {
  const cleanDate = normalizeDate(job.scheduledDate);
  const nextCleanDate = await getNextTurnoverCleanDate(job);
  const fallbackQuickReturnDays = Math.max(1, operations.fastReturnDaysWhenNoNextClean);

  let pickupDate = addDays(cleanDate, 1);
  let dropoffDate = addDays(pickupDate, 1);
  let status: LaundryStatus = LaundryStatus.PENDING;
  let flagReason: LaundryFlag | null = null;
  let flagNotes: string | null = null;
  let scenario: LaundryScenario = "FALLBACK";
  const minDropoffDate = addDays(pickupDate, 1);

  if (nextCleanDate) {
    const gapToNextClean = differenceInCalendarDays(nextCleanDate, cleanDate);
    const preferredDropoffDate = addDays(nextCleanDate, -1);

    if (gapToNextClean <= 1) {
      scenario = "BACK_TO_BACK";
    } else if (gapToNextClean <= 3) {
      scenario = "MICRO_CYCLE";
    } else {
      scenario = "COMPRESSED";
    }

    if (preferredDropoffDate >= minDropoffDate) {
      dropoffDate = preferredDropoffDate;
      flagNotes = "Return scheduled for the day before the next known clean.";
    } else {
      dropoffDate = minDropoffDate;
      flagNotes = "Tight gap detected; returning on the earliest valid date after 24h.";
    }

    if (scenario === "BACK_TO_BACK" && job.property.linenBufferSets <= 0) {
      status = LaundryStatus.FLAGGED;
      flagReason = LaundryFlag.EXPRESS_OR_EXTRA_LINEN_REQUIRED;
      flagNotes = "Back-to-back clean dates with no buffer linen set configured.";
    }
  } else {
    scenario = "FALLBACK";
    const requestedCap = Math.max(1, operations.maxOutdoorDays);
    if (operations.fastReturnWhenNoNextClean) {
      // No next clean is known yet, so return fast to keep linen on-site for late bookings.
      dropoffDate = addDays(pickupDate, fallbackQuickReturnDays);
      dropoffDate = capDropoffDate(pickupDate, dropoffDate, requestedCap);
      flagNotes =
        "No future clean date found yet. Fast-return scheduled so linen is available for late bookings.";
    } else {
      dropoffDate = addDays(pickupDate, requestedCap);
      flagNotes = `No future clean date found yet. Using fallback outdoor window of ${requestedCap} day${
        requestedCap === 1 ? "" : "s"
      }.`;
    }
  }

  if (differenceInCalendarDays(dropoffDate, pickupDate) < 1) {
    status = LaundryStatus.FLAGGED;
    flagReason = flagReason ?? LaundryFlag.NO_WINDOW;
    flagNotes = flagNotes ? `${flagNotes} 24h turnaround is not available.` : "24h turnaround is not available.";
  }

  return {
    jobId: job.id,
    propertyId: job.propertyId,
    propertyName: job.property.name,
    suburb: job.property.suburb,
    cleanDate: serializeDate(cleanDate),
    pickupDate: serializeDate(pickupDate),
    dropoffDate: serializeDate(dropoffDate),
    status,
    flagReason,
    flagNotes,
    scenario,
    linenBufferSets: job.property.linenBufferSets,
  };
}

async function getPlannerJobs(weekStart?: Date) {
  const where: Prisma.JobWhereInput = {
    jobType: "AIRBNB_TURNOVER",
    laundryTask: null,
    status: { not: "INVOICED" },
  };

  if (weekStart) {
    const start = normalizeDate(weekStart);
    const end = addDays(start, 7);
    where.scheduledDate = { gte: start, lt: end };
  }

  return db.job.findMany({
    where,
    include: {
      property: true,
    },
    orderBy: [{ scheduledDate: "asc" }, { propertyId: "asc" }],
  });
}

export async function buildLaundryPlanDraft(weekStart?: Date): Promise<LaundryPlanDraftItem[]> {
  const settings = await getAppSettings();
  const jobs = await getPlannerJobs(weekStart);
  const draft = await Promise.all(
    jobs.map((job) => computeDraftItem(job, settings.laundryOperations))
  );
  return draft.sort((a, b) => {
    const byPickup = new Date(a.pickupDate).getTime() - new Date(b.pickupDate).getTime();
    if (byPickup !== 0) return byPickup;
    const bySuburb = a.suburb.localeCompare(b.suburb);
    if (bySuburb !== 0) return bySuburb;
    return a.propertyName.localeCompare(b.propertyName);
  });
}

export async function applyLaundryPlanDraft(items: LaundryPlanDraftItem[]) {
  if (items.length === 0) return [];

  const applied = await db.$transaction(async (tx) => {
    const rows = [];
    for (const item of items) {
      const row = await tx.laundryTask.upsert({
        where: { jobId: item.jobId },
        update: {
          pickupDate: new Date(item.pickupDate),
          dropoffDate: new Date(item.dropoffDate),
          status: item.status,
          flagReason: item.flagReason,
          flagNotes: item.flagNotes,
          notifyLaundry: false,
        },
        create: {
          jobId: item.jobId,
          propertyId: item.propertyId,
          pickupDate: new Date(item.pickupDate),
          dropoffDate: new Date(item.dropoffDate),
          status: item.status,
          flagReason: item.flagReason,
          flagNotes: item.flagNotes,
          notifyLaundry: false,
        },
      });
      rows.push(row);
    }
    return rows;
  });

  logger.info({ count: applied.length }, "Laundry plan approved and applied");
  return applied;
}

/** Generate or refresh laundry tasks for a given week (or all pending jobs). */
export async function generateWeeklyLaundryPlan(weekStart?: Date): Promise<void> {
  const draft = await buildLaundryPlanDraft(weekStart);
  await applyLaundryPlanDraft(draft);
}

/** Ensure a laundry task exists for one turnover job. */
export async function ensureLaundryTaskForJob(jobId: string) {
  const existing = await db.laundryTask.findUnique({
    where: { jobId },
  });
  if (existing) {
    return existing;
  }

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      property: true,
    },
  });

  if (!job) return null;
  if (job.jobType !== "AIRBNB_TURNOVER") return null;

  const settings = await getAppSettings();
  const draftItem = await computeDraftItem(job, settings.laundryOperations);
  await applyLaundryPlanDraft([draftItem]);
  return db.laundryTask.findUnique({ where: { jobId } });
}
