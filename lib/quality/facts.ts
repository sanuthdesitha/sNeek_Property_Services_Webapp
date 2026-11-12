/**
 * Database readers for the Quality hub. Each loads one fact set with one
 * query; the groupings and totals are computed from these in memory (scale is
 * small: a handful of cleaners, tens of properties).
 */
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { holdsRoleWhere } from "@/lib/auth/role-query";
import { pickAuthoritativeReview } from "./authority";
import type { CleanFact } from "./cleans";
import type { IssueFact } from "./groupings";
import type { PeriodRange } from "./period";
import type { IssueListFilters, QualityFilters } from "./types";
import { cleanWhere, issueWhere } from "./where";

export type CategoryLabels = Map<string, string>;

export async function loadCategoryLabels(): Promise<CategoryLabels> {
  const settings = await getAppSettings().catch(() => null);
  return new Map((settings?.accountability.issueCategories ?? []).map((c) => [c.key, c.label || c.key]));
}

export function labelLookup(labels: CategoryLabels): (category: string) => string {
  return (category) => labels.get(category) ?? category;
}

export async function loadIssueFacts(
  range: PeriodRange,
  filters: QualityFilters | IssueListFilters,
  labels: CategoryLabels,
): Promise<IssueFact[]> {
  const rows = await db.qaIssue.findMany({
    where: issueWhere(range, filters, labels),
    select: {
      id: true,
      cleanerId: true,
      raisedById: true,
      category: true,
      severity: true,
      rectificationStatus: true,
      falseConfirmation: true,
      rectifiedById: true,
      rectificationMinutes: true,
      rectificationCost: true,
      createdAt: true,
      cleaner: { select: { name: true, email: true } },
      raisedBy: { select: { name: true, email: true, role: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    cleanerId: row.cleanerId,
    cleanerName: row.cleaner?.name ?? row.cleaner?.email ?? "Cleaner",
    raisedById: row.raisedById,
    raisedByName: row.raisedBy?.name ?? row.raisedBy?.email ?? "Inspector",
    raisedByRole: row.raisedBy?.role ?? "–",
    category: row.category,
    severity: row.severity,
    rectificationStatus: row.rectificationStatus,
    falseConfirmation: row.falseConfirmation,
    rectifiedById: row.rectifiedById,
    rectificationMinutes: row.rectificationMinutes,
    rectificationCost: row.rectificationCost,
    createdAt: row.createdAt,
  }));
}

/** Submitted cleans scheduled in `range`, each with its authoritative review. */
export async function loadCleanFacts(range: PeriodRange, filters: QualityFilters): Promise<CleanFact[]> {
  const jobs = await db.job.findMany({
    where: cleanWhere(range, filters),
    select: {
      id: true,
      scheduledDate: true,
      propertyId: true,
      assignments: { select: { userId: true } },
      qaReviews: { select: { score: true, kind: true, rating: true, managementReview: true, createdAt: true } },
    },
  });
  return jobs.map((job) => {
    const review = pickAuthoritativeReview(job.qaReviews);
    return {
      jobId: job.id,
      scheduledDate: job.scheduledDate,
      propertyId: job.propertyId,
      cleanerIds: Array.from(new Set(job.assignments.map((a) => a.userId))),
      review: review
        ? { score: review.score, rating: review.rating, managementReview: review.managementReview, createdAt: review.createdAt }
        : null,
    };
  });
}

export type PersonLite = { id: string; name: string };

export async function loadActiveCleaners(): Promise<PersonLite[]> {
  const rows = await db.user.findMany({
    where: { isActive: true, ...holdsRoleWhere(Role.CLEANER) },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  return rows.map((row) => ({ id: row.id, name: row.name ?? row.email ?? "Cleaner" }));
}
