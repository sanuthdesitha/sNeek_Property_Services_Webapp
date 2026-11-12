import "server-only";
import { db } from "@/lib/db";
import { buildLaundrySyncDraft, computeDraftItem, type LaundryRuleResolver } from "@/lib/laundry/planner";
import type { LaundrySyncDraftItem } from "@/lib/laundry/sync-draft";
import { airbnbReadinessDeadlineBy } from "@/lib/jobs/turnover-readiness";
import { parseJobInternalNotes, resolveRuleTime } from "@/lib/jobs/meta";
import { previewRecurringRun } from "@/lib/ops/recurring";
import { sydneyTodayKey } from "@/lib/time/sydney-range";
import type { RuleBook } from "./book";
import { diffRuleValues, laundryOperationsFrom, laundryPlanningFrom, type EditableRuleKey, type SchedulingRuleValues } from "./values";

/**
 * DRY RUN of a candidate rule set against the real data. Reads only; saves
 * nothing, sends nothing. Used by the review step of every publish, restore
 * and import, and by "Test against last month".
 */

const LAUNDRY_PLANNER_KEYS: EditableRuleKey[] = [
  "laundry.pickupOffsetDays", "laundry.minTurnaroundDays", "laundry.backToBackMaxGapDays", "laundry.microCycleMaxGapDays",
  "laundry.bufferFlagAtOrBelowSets", "laundry.keyLostServiceTime", "laundry.keyLostLateCheckoutTime",
  "laundry.maxOutdoorDays", "laundry.fastReturnWhenNoNextClean", "laundry.fastReturnDaysWhenNoNextClean",
];

export type LaundryPreview = {
  checked: boolean;
  properties: number;
  /** Future cleans with no run yet whose new run would be planned differently. */
  newRunsChanged: number;
  /** Existing pending runs that would move ONLY if "re-plan existing" is ticked. */
  existingRunsReplanned: number;
  samples: Array<{ propertyName: string; cleanDate: string; from: string; to: string; existing: boolean }>;
};

export type JobsPreview = {
  checked: boolean;
  futureTurnovers: number;
  /** Existing future turnovers whose ready-by time would change ONLY if "re-plan existing" is ticked. */
  existingTurnoversRetimed: number;
  samples: Array<{ propertyName: string; date: string; from: string; to: string }>;
};

export type RecurringPreview = {
  checked: boolean;
  liveWouldCreate: number;
  candidateWouldCreate: number;
};

export type RulePreview = {
  changedKeys: EditableRuleKey[];
  laundry: LaundryPreview;
  jobs: JobsPreview;
  recurring: RecurringPreview;
  /** Rules checked at each run from the effective date (no per-item count). */
  runTimeKeys: EditableRuleKey[];
};

function itemSummary(item: Pick<LaundrySyncDraftItem, "pickupDate" | "dropoffDate" | "status" | "flagReason">): string {
  return `${item.pickupDate.slice(0, 16)} → ${item.dropoffDate.slice(0, 16)} ${item.status}${item.flagReason ? ` ${item.flagReason}` : ""}`;
}

function keyed(items: LaundrySyncDraftItem[]) {
  return new Map(items.map((item) => [item.jobId, item]));
}

async function previewLaundry(book: RuleBook, candidate: SchedulingRuleValues, sampleLimit: number): Promise<LaundryPreview> {
  const properties = await db.property.findMany({ where: { laundryEnabled: true, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const live: LaundryRuleResolver = { forNewRun: () => book.live.values, forExistingRun: (task) => book.forItem(task.createdAt).values };
  const candidateNew: LaundryRuleResolver = { forNewRun: () => candidate, forExistingRun: live.forExistingRun };
  const candidateAll: LaundryRuleResolver = { forNewRun: () => candidate, forExistingRun: () => candidate };
  let newRunsChanged = 0;
  let existingRunsReplanned = 0;
  const samples: LaundryPreview["samples"] = [];
  for (const property of properties) {
    const [liveItems, newItems, allItems] = await Promise.all([
      buildLaundrySyncDraft({ propertyId: property.id }, live),
      buildLaundrySyncDraft({ propertyId: property.id }, candidateNew),
      buildLaundrySyncDraft({ propertyId: property.id }, candidateAll),
    ]);
    const liveByJob = keyed(liveItems);
    for (const item of newItems) {
      if (item.operation !== "CREATE") continue;
      const before = liveByJob.get(item.jobId);
      if (!before || itemSummary(before) !== itemSummary(item)) {
        newRunsChanged += 1;
        if (samples.length < sampleLimit) samples.push({ propertyName: property.name, cleanDate: item.cleanDate.slice(0, 10), from: before ? itemSummary(before) : "—", to: itemSummary(item), existing: false });
      }
    }
    for (const item of allItems) {
      if (item.operation !== "UPDATE") continue;
      const before = liveByJob.get(item.jobId);
      if (!before || itemSummary(before) !== itemSummary(item)) {
        existingRunsReplanned += 1;
        if (samples.length < sampleLimit) {
          const current = { pickupDate: item.currentPickupDate ?? "", dropoffDate: item.currentDropoffDate ?? "", status: item.currentStatus ?? item.status, flagReason: item.currentFlagReason ?? null };
          samples.push({ propertyName: property.name, cleanDate: item.cleanDate.slice(0, 10), from: itemSummary(before ?? current), to: itemSummary(item), existing: true });
        }
      }
    }
  }
  return { checked: true, properties: properties.length, newRunsChanged, existingRunsReplanned, samples };
}

type TurnoverRow = {
  scheduledDate: Date;
  createdAt: Date;
  sameDayCheckinTime: string | null;
  internalNotes: string | null;
  property: { name: string; defaultCheckinTime: string; jobTimeSource: string };
};

/** The due time the iCal sync derives for a turnover with a given "ready by" (lib/ical/times.ts). */
export function turnoverDueWith(job: TurnoverRow, readyBy: string): string {
  const rawDue = job.property.jobTimeSource === "ICAL" ? job.sameDayCheckinTime ?? job.property.defaultCheckinTime : job.property.defaultCheckinTime;
  const early = resolveRuleTime(parseJobInternalNotes(job.internalNotes).earlyCheckin);
  return airbnbReadinessDeadlineBy(readyBy, rawDue, early);
}

const TURNOVER_SELECT = {
  scheduledDate: true,
  createdAt: true,
  sameDayCheckinTime: true,
  internalNotes: true,
  property: { select: { name: true, defaultCheckinTime: true, jobTimeSource: true } },
} as const;

async function previewJobs(book: RuleBook, candidate: SchedulingRuleValues, now: Date, sampleLimit: number): Promise<JobsPreview> {
  const today = new Date(`${sydneyTodayKey(now)}T00:00:00.000Z`);
  const jobs = await db.job.findMany({
    where: {
      jobType: "AIRBNB_TURNOVER",
      reservationId: { not: null },
      manuallyRescheduledAt: null,
      scheduledDate: { gte: today },
      status: { notIn: ["COMPLETED", "INVOICED", "CANCELLED"] },
    },
    select: TURNOVER_SELECT,
    orderBy: { scheduledDate: "asc" },
    take: 2000,
  });
  let existingTurnoversRetimed = 0;
  const samples: JobsPreview["samples"] = [];
  for (const job of jobs) {
    const before = turnoverDueWith(job, book.forItem(job.createdAt).values["jobs.turnoverReadyByTime"]);
    const after = turnoverDueWith(job, candidate["jobs.turnoverReadyByTime"]);
    if (before !== after) {
      existingTurnoversRetimed += 1;
      if (samples.length < sampleLimit) samples.push({ propertyName: job.property.name, date: job.scheduledDate.toISOString().slice(0, 10), from: `ready by ${before}`, to: `ready by ${after}` });
    }
  }
  return { checked: true, futureTurnovers: jobs.length, existingTurnoversRetimed, samples };
}

const RUN_TIME_KEYS: EditableRuleKey[] = [
  "laundry.defaultCleanStartTime", "laundry.pickedUpStaleHours", "laundry.autoApproveSyncDrafts", "laundry.syncNotificationHorizonDays",
  "jobs.autoAssignEnabled", "jobs.autoAssignMaxDailyJobs", "jobs.autoAssignWeightSuburbHistory", "jobs.autoAssignWeightQaScore", "jobs.autoAssignWeightCurrentLoad",
  "jobs.routeGroupBySuburb", "jobs.routeMaxStopsPerRun", "jobs.autoClockOutEnabled", "jobs.autoClockOutStopAtEstimate", "jobs.autoClockOutGraceMinutes",
  "jobs.autoClockOutFallbackAtMidnight", "jobs.autoClockOutMaxJobLengthHours", "jobs.autoClockOutGeofenceExit", "jobs.autoPauseAfterHours", "jobs.staleEnRouteHours",
  "jobs.qaFailureThreshold", "jobs.qaOfferReworkOnFail", "jobs.qaReworkDelayHours", "jobs.qaAutoScoreEnabled", "jobs.qaAutoScoreAfterHours",
  "jobs.reminderDayBeforeEnabled", "jobs.reminderTwoHourEnabled", "jobs.dayReminderUnlockHour", "jobs.dayReminderLeadHours", "laundry.maxOutdoorDays",
];

export async function previewRuleChange(book: RuleBook, candidate: SchedulingRuleValues, now: Date = new Date()): Promise<RulePreview> {
  const changes = diffRuleValues(book.live.values, candidate);
  const changedKeys = changes.map((change) => change.key);
  const touches = (keys: EditableRuleKey[]) => changedKeys.some((key) => keys.includes(key));
  const sampleLimit = 12;
  const laundry: LaundryPreview = touches(LAUNDRY_PLANNER_KEYS)
    ? await previewLaundry(book, candidate, sampleLimit)
    : { checked: false, properties: 0, newRunsChanged: 0, existingRunsReplanned: 0, samples: [] };
  const jobs: JobsPreview = touches(["jobs.turnoverReadyByTime"])
    ? await previewJobs(book, candidate, now, sampleLimit)
    : { checked: false, futureTurnovers: 0, existingTurnoversRetimed: 0, samples: [] };
  let recurring: RecurringPreview = { checked: false, liveWouldCreate: 0, candidateWouldCreate: 0 };
  if (touches(["jobs.recurringEnabled", "jobs.recurringLookaheadDays"])) {
    const [liveRun, candidateRun] = await Promise.all([
      previewRecurringRun({ enabled: book.live.values["jobs.recurringEnabled"], lookaheadDays: book.live.values["jobs.recurringLookaheadDays"], now }),
      previewRecurringRun({ enabled: candidate["jobs.recurringEnabled"], lookaheadDays: candidate["jobs.recurringLookaheadDays"], now }),
    ]);
    recurring = { checked: true, liveWouldCreate: liveRun.wouldCreate, candidateWouldCreate: candidateRun.wouldCreate };
  }
  return { changedKeys, laundry, jobs, recurring, runTimeKeys: changedKeys.filter((key) => RUN_TIME_KEYS.includes(key)) };
}

// ── Test against last month ─────────────────────────────────────────────────

export type LastMonthSimulation = {
  from: string;
  to: string;
  laundry: { cleans: number; differ: number; samples: Array<{ propertyName: string; cleanDate: string; current: string; candidate: string; actual: string | null }> };
  jobs: { turnovers: number; differ: number; samples: Array<{ propertyName: string; date: string; current: string; candidate: string }> };
};

/**
 * Replays last month's cleans through the CURRENT rules and the CANDIDATE
 * rules and lists where they differ, beside what actually happened. Pure
 * reads; nothing is saved, planned or sent.
 */
export async function simulateLastMonth(book: RuleBook, candidate: SchedulingRuleValues, now: Date = new Date()): Promise<LastMonthSimulation> {
  const todayKey = sydneyTodayKey(now);
  const end = new Date(`${todayKey}T00:00:00.000Z`);
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  const cleans = await db.job.findMany({
    where: { jobType: "AIRBNB_TURNOVER", isRework: false, scheduledDate: { gte: start, lt: end }, property: { laundryEnabled: true } },
    include: { property: true, laundryTask: { select: { pickupDate: true, dropoffDate: true, status: true, flagReason: true, createdAt: true } } },
    orderBy: { scheduledDate: "asc" },
    take: 1000,
  });
  const laundrySamples: LastMonthSimulation["laundry"]["samples"] = [];
  let laundryDiffer = 0;
  for (const job of cleans) {
    const currentValues = job.laundryTask ? book.forItem(job.laundryTask.createdAt).values : book.live.values;
    const [current, next] = await Promise.all([
      computeDraftItem(job, laundryOperationsFrom(currentValues), db, laundryPlanningFrom(currentValues)),
      computeDraftItem(job, laundryOperationsFrom(candidate), db, laundryPlanningFrom(candidate)),
    ]);
    const a = itemSummary(current);
    const b = itemSummary(next);
    if (a !== b) {
      laundryDiffer += 1;
      if (laundrySamples.length < 20) {
        const actual = job.laundryTask ? itemSummary({ pickupDate: job.laundryTask.pickupDate.toISOString(), dropoffDate: job.laundryTask.dropoffDate.toISOString(), status: job.laundryTask.status, flagReason: job.laundryTask.flagReason }) : null;
        laundrySamples.push({ propertyName: job.property.name, cleanDate: job.scheduledDate.toISOString().slice(0, 10), current: a, candidate: b, actual });
      }
    }
  }
  const turnovers = await db.job.findMany({
    where: { jobType: "AIRBNB_TURNOVER", reservationId: { not: null }, scheduledDate: { gte: start, lt: end } },
    select: TURNOVER_SELECT,
    orderBy: { scheduledDate: "asc" },
    take: 2000,
  });
  const jobSamples: LastMonthSimulation["jobs"]["samples"] = [];
  let jobsDiffer = 0;
  for (const job of turnovers) {
    const current = turnoverDueWith(job, book.forItem(job.createdAt).values["jobs.turnoverReadyByTime"]);
    const next = turnoverDueWith(job, candidate["jobs.turnoverReadyByTime"]);
    if (current !== next) {
      jobsDiffer += 1;
      if (jobSamples.length < 20) jobSamples.push({ propertyName: job.property.name, date: job.scheduledDate.toISOString().slice(0, 10), current: `ready by ${current}`, candidate: `ready by ${next}` });
    }
  }
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
    laundry: { cleans: cleans.length, differ: laundryDiffer, samples: laundrySamples },
    jobs: { turnovers: turnovers.length, differ: jobsDiffer, samples: jobSamples },
  };
}
