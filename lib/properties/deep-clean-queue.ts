import "server-only";
/**
 * Deep-clean scheduling screen data (board "Deep clean", 2026-11-16). Reads
 * only: the queue of stored plans, the properties with no verified deep
 * clean, a property's candidate jobs with their evidence, its history, and
 * the guests-staying / turnover marks for the date panel from bookings and
 * jobs already stored. The rule and its writes stay in
 * lib/properties/deep-clean-planning.ts.
 */
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { getAuthoritativeQaReview } from "@/lib/qa/authority";
import { deepCleanBaselineStatus, listStoredDeepCleanPlans, readDeepCleanPlan, type DeepCleanPlan } from "./deep-clean-planning";
import {
  queueStateFor,
  queueTiles,
  sortQueue,
  type Candidate,
  type DayMarks,
  type DeepCleanQueue,
  type HistoryEntry,
  type QueueRow,
} from "./deep-clean-queue-model";

const TZ = "Australia/Sydney";

function sydneyDay(at: Date): string {
  return formatInTimeZone(at, TZ, "yyyy-MM-dd");
}

async function userNames(ids: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((user) => [user.id, user.name || user.email || "Someone"]));
}

export async function buildDeepCleanQueue(canManage: boolean, now = new Date()): Promise<DeepCleanQueue> {
  const today = sydneyDay(now);
  const [stored, properties] = await Promise.all([
    listStoredDeepCleanPlans(),
    db.property.findMany({ where: { isActive: true }, select: { id: true, name: true, suburb: true, bedrooms: true, client: { select: { name: true } } }, orderBy: { name: "asc" } }),
  ]);
  const byId = new Map(properties.map((property) => [property.id, property]));
  const plans = stored.filter((entry) => byId.has(entry.propertyId));
  const jobIds = plans.flatMap((entry) => [entry.plan?.baseline?.jobId ?? "", entry.plan?.proposal?.jobId ?? ""]).filter(Boolean);
  const [jobs, assigned, names] = await Promise.all([
    db.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, jobNumber: true } }),
    db.jobAssignment.groupBy({ by: ["jobId"], where: { jobId: { in: jobIds }, removedAt: null }, _count: { _all: true } }),
    userNames(plans.map((entry) => entry.plan?.baseline?.verifiedBy ?? "")),
  ]);
  const jobNumber = new Map(jobs.map((job) => [job.id, job.jobNumber]));
  const assignedJobs = new Set(assigned.map((row) => row.jobId));

  const rows: QueueRow[] = [];
  for (const entry of plans) {
    const property = byId.get(entry.propertyId)!;
    const plan = entry.plan;
    const status = plan?.baseline ? await deepCleanBaselineStatus(plan, now) : { current: false, reason: null };
    const state = queueStateFor(plan, status.current, today);
    if (!state) continue;
    const proposal = plan?.proposal && plan.proposal.status !== "SUPERSEDED" ? plan.proposal : null;
    rows.push({
      propertyId: property.id,
      propertyName: property.name,
      clientName: property.client?.name ?? null,
      suburb: property.suburb,
      bedrooms: property.bedrooms ?? null,
      state,
      dueDay: proposal?.dueDay ?? plan?.baseline?.dueDay ?? null,
      revision: plan?.revision ?? 0,
      baseline: plan?.baseline
        ? {
            jobId: plan.baseline.jobId,
            jobNumber: jobNumber.get(plan.baseline.jobId) ?? null,
            completedDay: plan.baseline.completedDay,
            verifiedByName: names.get(plan.baseline.verifiedBy) ?? "an administrator",
            verifiedAt: plan.baseline.verifiedAt,
          }
        : null,
      proposal: proposal
        ? {
            id: proposal.id,
            status: proposal.status,
            scheduledDay: proposal.scheduledDay,
            jobId: proposal.jobId,
            jobNumber: proposal.jobId ? jobNumber.get(proposal.jobId) ?? null : null,
            assigned: proposal.jobId ? assignedJobs.has(proposal.jobId) : null,
          }
        : null,
      changeReason: state === "evidence_changed" ? status.reason : null,
    });
  }
  const verified = new Set(plans.filter((entry) => entry.plan?.baseline).map((entry) => entry.propertyId));
  const noBaseline = properties.filter((property) => !verified.has(property.id)).map((property) => ({ propertyId: property.id, propertyName: property.name }));
  return { today, timeZone: TZ, canManage, rows: sortQueue(rows), tiles: queueTiles(rows, noBaseline.length), noBaseline };
}

/** The last 50 completed deep cleans at the property, with why one cannot be chosen. */
export async function deepCleanCandidates(propertyId: string, now = new Date()): Promise<Candidate[]> {
  const jobs = await db.job.findMany({
    where: { propertyId, jobType: "DEEP_CLEAN", isRework: false, status: { in: ["COMPLETED", "INVOICED"] }, completedAt: { lte: now } },
    orderBy: { completedAt: "desc" },
    take: 50,
    select: {
      id: true, jobNumber: true, completedAt: true, internalNotes: true,
      assignments: { where: { removedAt: null }, select: { user: { select: { name: true, email: true } } } },
      formSubmissions: { orderBy: { createdAt: "desc" }, take: 1, select: { media: { where: { mediaType: { in: ["PHOTO", "VIDEO"] } }, select: { mediaType: true, s3Key: true } } } },
    },
  });
  const candidates: Candidate[] = [];
  for (const job of jobs) {
    if (parseJobInternalNotes(job.internalNotes).isDraft) continue;
    const media = (job.formSubmissions[0]?.media ?? []).filter((item) => item.s3Key?.trim());
    const qa = await getAuthoritativeQaReview(job.id);
    const photos = media.filter((item) => item.mediaType === "PHOTO").length;
    const videos = media.filter((item) => item.mediaType === "VIDEO").length;
    let blocked: string | null = null;
    if (photos + videos === 0) blocked = "no submitted proof";
    else if (qa && !qa.passed) blocked = `QA failed${qa.notes ? ` (${qa.notes.slice(0, 80)})` : ""}`;
    candidates.push({
      id: job.id,
      jobNumber: job.jobNumber,
      completedDay: job.completedAt ? sydneyDay(job.completedAt) : null,
      cleaners: job.assignments.map((assignment) => assignment.user?.name || assignment.user?.email || "Cleaner"),
      photos,
      videos,
      qa: qa ? { passed: qa.passed, score: Math.round(qa.score), notes: qa.notes ?? null } : null,
      blocked,
    });
  }
  return candidates;
}

const ACTION_WORDS: Record<string, string> = {
  DEEP_CLEAN_BASELINE_VERIFIED: "Baseline verified",
  DEEP_CLEAN_PROPOSAL_CREATED: "Proposal created",
  DEEP_CLEAN_PROPOSAL_SCHEDULED: "Draft job created",
};

/** The property's deep-clean history from its audit rows, newest first. */
export async function deepCleanHistory(propertyId: string): Promise<HistoryEntry[]> {
  const rows = await db.auditLog.findMany({
    where: { entity: "Property", entityId: propertyId, action: { in: Object.keys(ACTION_WORDS) } },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { action: true, createdAt: true, after: true, user: { select: { name: true, email: true } } },
  });
  const plans = rows.map((row) => row.after as Partial<DeepCleanPlan> & { automation?: unknown } | null);
  const jobIds = plans.flatMap((plan) => [plan?.baseline?.jobId ?? "", plan?.proposal?.jobId ?? ""]).filter(Boolean);
  const numbers = new Map((await db.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, jobNumber: true } })).map((job) => [job.id, job.jobNumber]));
  return rows.map((row, index) => {
    const plan = plans[index];
    const automated = Boolean(plan && typeof plan === "object" && "automation" in plan && plan.automation);
    let text = ACTION_WORDS[row.action] ?? row.action;
    if (row.action === "DEEP_CLEAN_BASELINE_VERIFIED" && plan?.baseline) text = `Baseline ${numbers.get(plan.baseline.jobId) ?? "job"} verified · due ${plan.baseline.dueDay}`;
    if (row.action === "DEEP_CLEAN_PROPOSAL_CREATED" && plan?.proposal) text = `Proposal due ${plan.proposal.dueDay}, needs a date`;
    if (row.action === "DEEP_CLEAN_PROPOSAL_SCHEDULED" && plan?.proposal) text = `${plan.proposal.jobId ? numbers.get(plan.proposal.jobId) ?? "Job" : "Job"} draft created for ${plan.proposal.scheduledDay}`;
    return { at: row.createdAt.toISOString(), text, actor: automated ? "daily check" : row.user?.name || row.user?.email || null };
  });
}

/**
 * Guests staying (a booked night) and turnovers booked (a turnover job), per
 * Sydney day, for the date panel. From stored bookings and jobs only.
 */
export async function deepCleanDayMarks(propertyId: string, from: string, to: string): Promise<DayMarks> {
  const start = fromZonedTime(`${from}T00:00:00`, TZ);
  const end = fromZonedTime(`${to}T23:59:59`, TZ);
  const [reservations, turnovers] = await Promise.all([
    db.reservation.findMany({ where: { propertyId, startDate: { lte: end }, endDate: { gte: start } }, select: { startDate: true, endDate: true } }),
    db.job.findMany({ where: { propertyId, jobType: "AIRBNB_TURNOVER", scheduledDate: { gte: start, lte: end }, status: { not: "CANCELLED" } }, select: { scheduledDate: true } }),
  ]);
  const guests = new Set<string>();
  for (const reservation of reservations) {
    const last = sydneyDay(reservation.endDate);
    const cursor = new Date(`${sydneyDay(reservation.startDate)}T12:00:00Z`);
    // Nights stayed: from check-in day up to (not including) the check-out day.
    while (cursor.toISOString().slice(0, 10) < last) {
      const day = cursor.toISOString().slice(0, 10);
      if (day >= from && day <= to) guests.add(day);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  const turnoverDays = new Set(turnovers.map((job) => sydneyDay(job.scheduledDate)).filter((day) => day >= from && day <= to));
  return { guests: Array.from(guests).sort(), turnovers: Array.from(turnoverDays).sort() };
}

/** What the scheduling panels add to the property's plan read (candidates with evidence, history). */
export async function deepCleanPropertyDetail(propertyId: string, now = new Date()) {
  const [planView, candidates, history] = await Promise.all([
    readDeepCleanPlan(propertyId, now),
    deepCleanCandidates(propertyId, now),
    deepCleanHistory(propertyId),
  ]);
  const status = planView.plan.baseline ? await deepCleanBaselineStatus(planView.plan, now) : { current: false, reason: null };
  return { candidateDetails: candidates, history, changeReason: status.reason, baselineValid: planView.baselineValid };
}
