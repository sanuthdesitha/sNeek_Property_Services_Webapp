import "server-only";
/**
 * The Properties list side panel: what the office checks about one property
 * without leaving the list. Read only; each fact comes from the table that
 * owns it, and the derived columns are the list's own (buildPortfolioRows).
 */
import { JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { resolveJobFormTemplate } from "@/lib/forms/resolve-job-template";
import { extractLaundryTeamUserIds } from "@/lib/laundry/teams";
import { CARE_KIND, careMetadata } from "@/lib/property-care/policy";
import { sydneyDateKey, sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";
import { buildPortfolioRows } from "./portfolio-list";
import { UPCOMING_JOB_STATUSES } from "./portfolio-facts";
import { describeLaundryTeam } from "./laundry-team";
import type { ChecklistSummary, LaundrySummary, PropertyPreview, RecentEvent, UpcomingJob } from "./preview-types";

const FINISHED: JobStatus[] = [JobStatus.SUBMITTED, JobStatus.QA_REVIEW, JobStatus.COMPLETED, JobStatus.INVOICED];

const jobSelect = {
  id: true,
  jobNumber: true,
  scheduledDate: true,
  startTime: true,
  jobType: true,
  status: true,
  assignments: { where: { removedAt: null }, select: { user: { select: { name: true, email: true } } } },
} as const;

type JobRow = {
  id: string;
  jobNumber: string;
  scheduledDate: Date;
  startTime: string | null;
  jobType: string;
  status: string;
  assignments: Array<{ user: { name: string | null; email: string } }>;
};

export function toUpcomingJob(job: JobRow): UpcomingJob {
  return {
    jobId: job.id,
    jobNumber: job.jobNumber,
    dayKey: sydneyDateKey(job.scheduledDate),
    startTime: job.startTime,
    jobType: job.jobType,
    status: job.status,
    cleaners: job.assignments.map((assignment) => assignment.user.name ?? assignment.user.email),
  };
}

/** The template a turnover at this property would use today, by the same resolver jobs use. */
export async function resolveTurnoverChecklist(propertyId: string): Promise<ChecklistSummary> {
  const [settings, templates] = await Promise.all([
    getAppSettings(),
    db.formTemplate.findMany({
      where: { isActive: true, serviceType: "AIRBNB_TURNOVER" },
      select: { id: true, name: true, serviceType: true, isActive: true, version: true, isJobScoped: true, createdAt: true, updatedAt: true },
    }),
  ]);
  const resolved = resolveJobFormTemplate({ jobType: "AIRBNB_TURNOVER", propertyId, overrides: settings.propertyFormTemplateOverrides, templates });
  if (!resolved.template) return null;
  return { name: resolved.template.name, version: resolved.template.version, source: resolved.source };
}

export async function loadLaundrySummary(property: { laundryEnabled: boolean; accessInfo: unknown; laundryBagLabel: string | null; laundryBagColor: string | null }): Promise<LaundrySummary> {
  return {
    enabled: property.laundryEnabled !== false,
    partners: await describeLaundryTeam(extractLaundryTeamUserIds(property.accessInfo)),
    bagLabel: property.laundryBagLabel,
    bagColor: property.laundryBagColor,
  };
}

function humanAction(action: string): string {
  const text = action.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

async function loadRecent(propertyId: string): Promise<RecentEvent[]> {
  const [review, delivery, change] = await Promise.all([
    db.qAReview.findFirst({ where: { job: { propertyId } }, orderBy: { createdAt: "desc" }, select: { createdAt: true, score: true } }),
    db.laundryTask.findFirst({ where: { propertyId, droppedAt: { not: null } }, orderBy: { droppedAt: "desc" }, select: { droppedAt: true } }),
    db.auditLog.findFirst({ where: { entity: "Property", entityId: propertyId }, orderBy: { createdAt: "desc" }, select: { createdAt: true, action: true } }),
  ]);
  const events: RecentEvent[] = [];
  if (review) events.push({ kind: "qa", at: review.createdAt.toISOString(), text: `QA ${Math.round(review.score)}` });
  if (delivery?.droppedAt) events.push({ kind: "laundry", at: delivery.droppedAt.toISOString(), text: "Laundry delivered" });
  if (change) events.push({ kind: "change", at: change.createdAt.toISOString(), text: humanAction(change.action) });
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

export async function loadPropertyPreview(propertyId: string, now: Date = new Date()): Promise<PropertyPreview | null> {
  const property = await db.property.findUnique({
    where: { id: propertyId },
    select: {
      id: true, name: true, address: true, suburb: true, imageUrl: true, bedrooms: true, bathrooms: true, sofaBedCount: true, isActive: true,
      accessInfo: true, accessCode: true, accessGuide: true, laundryEnabled: true, laundryBagLabel: true, laundryBagColor: true,
      client: { select: { id: true, name: true } },
    },
  });
  if (!property || !property.isActive) return null;

  const today = sydneyDayStart(sydneyTodayKey(now));
  const [rows, checklist, laundry, upcoming, recentJobs, careTasks, recent] = await Promise.all([
    buildPortfolioRows({ includeOneOff: true, ids: [propertyId] }, now),
    resolveTurnoverChecklist(propertyId),
    loadLaundrySummary(property),
    db.job.findMany({ where: { propertyId, status: { in: UPCOMING_JOB_STATUSES }, scheduledDate: { gte: today } }, orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }], take: 3, select: jobSelect }),
    db.job.findMany({ where: { propertyId, status: { in: FINISHED } }, orderBy: { scheduledDate: "desc" }, take: 5, select: jobSelect }),
    db.jobTask.findMany({
      where: { propertyId, executionStatus: "OPEN", metadata: { path: ["kind"], equals: CARE_KIND } },
      orderBy: { createdAt: "asc" },
      take: 5,
      select: { id: true, title: true, metadata: true, job: { select: { jobNumber: true, scheduledDate: true } } },
    }),
    loadRecent(propertyId),
  ]);
  const row = rows.rows[0];
  const access = (property.accessInfo ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

  return {
    id: property.id,
    name: property.name,
    address: property.address,
    suburb: property.suburb,
    client: property.client,
    imageUrl: property.imageUrl ?? null,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    sofaBedCount: property.sofaBedCount,
    calendar: row?.calendar ?? { kind: "not-linked" },
    flags: row?.flags ?? [],
    qa: row?.qa ?? { score: null, reviewed: 0 },
    checklist,
    laundry,
    access: {
      lockbox: text(access.lockbox),
      parking: text(access.parking),
      instructions: text(access.instructions),
      // Whether a door code is on file; the code itself never leaves the property page.
      codeRecorded: Boolean(property.accessCode) || Boolean(text(access.codes)),
      guideSteps: Array.isArray(property.accessGuide) ? property.accessGuide.length : 0,
    },
    upcoming: upcoming.map(toUpcomingJob),
    recentJobs: recentJobs.map(toUpcomingJob),
    care: careTasks.map((task) => ({
      id: task.id,
      title: task.title,
      due: typeof careMetadata(task.metadata)?.due === "string" ? careMetadata(task.metadata).due : null,
      plannedDayKey: task.job ? sydneyDateKey(task.job.scheduledDate) : null,
      jobNumber: task.job?.jobNumber ?? null,
    })),
    recent,
  };
}
