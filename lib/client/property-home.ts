import "server-only";
import { JobStatus } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { propertyScopeWhere, type ClientPortalContext } from "@/lib/auth/client-portal";
import { listClientApprovals } from "@/lib/commercial/client-approvals";

export const ACTIVE_CLIENT_JOB_STATUSES: JobStatus[] = ["UNASSIGNED", "OFFERED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL", "SUBMITTED", "QA_REVIEW"];
export function clientTodayKey(now = new Date()) { return new Date(`${formatInTimeZone(now, "Australia/Sydney", "yyyy-MM-dd")}T00:00:00.000Z`); }
export type PropertyHomeRow = {
  id: string; name: string; suburb: string; bedrooms: number; bathrooms: number; hasBalcony: boolean;
  next: { id: string; day: string; startTime: string | null; phase: string | null; updatedAt: string } | null | "hidden";
  last: { id: string; day: string; reportId: string | null } | null | "unavailable" | "hidden";
  approvals: number | "unavailable" | "hidden";
};

const PHASES: Partial<Record<JobStatus, string>> = {
  UNASSIGNED: "Scheduling the clean", OFFERED: "Scheduling the clean", ASSIGNED: "Cleaner assigned",
  EN_ROUTE: "Cleaner on the way", IN_PROGRESS: "Cleaning underway", PAUSED: "Cleaning paused",
  WAITING_CONTINUATION_APPROVAL: "Waiting for continuation approval", SUBMITTED: "Cleaning submitted for review", QA_REVIEW: "Quality review underway",
};

/** One next job per authorized property, independent of the historical jobs-board cap. */
export async function loadPropertyHomeRows(portal: ClientPortalContext, now = new Date()): Promise<PropertyHomeRow[]> {
  if (!portal.visibility.showProperties || !portal.permissions.properties) return [];
  const where = { ...propertyScopeWhere(portal), isActive: true };
  const showJobs = portal.visibility.showJobs;
  const showReports = portal.visibility.showReports && portal.permissions.reports;
  const showApprovals = portal.actor === "CLIENT" && portal.visibility.showApprovals;
  const [properties, history, approvals] = await Promise.all([
    db.property.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], select: {
      id: true, name: true, suburb: true, bedrooms: true, bathrooms: true, hasBalcony: true,
      jobs: showJobs ? { where: { scheduledDate: { gte: clientTodayKey(now) }, status: { in: ACTIVE_CLIENT_JOB_STATUSES } },
        orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }, { id: "asc" }], take: 1,
        select: { id: true, scheduledDate: true, startTime: true, status: true, updatedAt: true } } : false,
    } }),
    showJobs ? db.property.findMany({ where, select: { id: true, jobs: {
      where: { status: { in: [JobStatus.COMPLETED, JobStatus.INVOICED] } },
      orderBy: [{ scheduledDate: "desc" }, { id: "desc" }], take: 1,
      select: { id: true, scheduledDate: true, report: { select: { id: true, clientVisible: true } } },
    } } }).catch(() => null) : Promise.resolve([]),
    showApprovals ? listClientApprovals({ clientId: portal.clientId, status: "PENDING", strict: true }).catch(() => null) : Promise.resolve([]),
  ]);
  const lastByProperty = new Map(history?.map(property => [property.id, property.jobs[0]]) ?? []);
  const decisions = new Map<string, number>();
  for (const approval of approvals ?? []) if (approval.propertyId) decisions.set(approval.propertyId, (decisions.get(approval.propertyId) ?? 0) + 1);
  return properties.map(property => {
    const next = property.jobs?.[0]; const last = lastByProperty.get(property.id);
    return { id: property.id, name: property.name, suburb: property.suburb, bedrooms: property.bedrooms, bathrooms: property.bathrooms, hasBalcony: property.hasBalcony,
      next: !showJobs ? "hidden" : next ? { id: next.id, day: next.scheduledDate.toISOString().slice(0, 10), startTime: next.startTime,
        phase: portal.visibility.showLiveProgress ? PHASES[next.status] ?? "Service status unavailable" : null, updatedAt: next.updatedAt.toISOString() } : null,
      last: !showJobs ? "hidden" : history === null ? "unavailable" : last ? { id: last.id, day: last.scheduledDate.toISOString().slice(0, 10), reportId: showReports && last.report?.clientVisible ? last.report.id : null } : null,
      approvals: !showApprovals ? "hidden" : approvals === null ? "unavailable" : decisions.get(property.id) ?? 0,
    };
  });
}
