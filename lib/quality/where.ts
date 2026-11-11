/**
 * The one filtered issue query behind every Quality hub grouping. The Issues
 * list, the Cleaners, Inspectors and Categories tabs and the stat cards all
 * read `QaIssue` through `issueWhere`, so their totals describe the same rows.
 *
 * Cleans (jobs) use `cleanWhere`: the period applies to the job's scheduled
 * Sydney day, and only the property, cleaner and free-text filters apply,
 * because category, open-fix and inspector filters describe issues, not jobs.
 */
import { JobStatus, type Prisma } from "@prisma/client";
import type { PeriodRange } from "./period";
import type { IssueListFilters, QualityFilters } from "./types";
import { OPEN_RECTIFICATION_STATUSES } from "./types";

/** A clean that reached submission: the base "cleans" count is built on these. */
export const SUBMITTED_JOB_STATUSES: JobStatus[] = [
  JobStatus.SUBMITTED,
  JobStatus.QA_REVIEW,
  JobStatus.COMPLETED,
  JobStatus.INVOICED,
];

function dateRange(range: PeriodRange): Prisma.DateTimeFilter {
  return range.start ? { gte: range.start, lt: range.end } : { lt: range.end };
}

/** Category keys whose label contains the search text (labels live in settings). */
export function categoryKeysMatching(q: string, labels: Map<string, string>): string[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return Array.from(labels.entries())
    .filter(([key, label]) => key.toLowerCase().includes(needle) || label.toLowerCase().includes(needle))
    .map(([key]) => key);
}

function issueSearch(q: string, labels: Map<string, string>): Prisma.QaIssueWhereInput | null {
  const text = q.trim();
  if (!text) return null;
  const contains = { contains: text, mode: "insensitive" as const };
  const categoryKeys = categoryKeysMatching(text, labels);
  return {
    OR: [
      // An exact issue id (the case timeline links to its issue this way).
      { id: text },
      { description: contains },
      { category: contains },
      ...(categoryKeys.length ? [{ category: { in: categoryKeys } }] : []),
      { cleaner: { name: contains } },
      { property: { name: contains } },
      { job: { jobNumber: contains } },
    ],
  };
}

export function issueWhere(
  range: PeriodRange,
  filters: QualityFilters | IssueListFilters,
  labels: Map<string, string> = new Map(),
): Prisma.QaIssueWhereInput {
  const issueOnly = filters as Partial<IssueListFilters>;
  const and: Prisma.QaIssueWhereInput[] = [{ createdAt: dateRange(range) }];
  if (filters.propertyId) and.push({ propertyId: filters.propertyId });
  if (filters.category) and.push({ category: filters.category });
  if (filters.cleanerId) and.push({ cleanerId: filters.cleanerId });
  if (filters.raisedById) and.push({ raisedById: filters.raisedById });
  if (filters.openFixes) and.push({ rectificationStatus: { in: [...OPEN_RECTIFICATION_STATUSES] } });
  if (issueOnly.severity) and.push({ severity: issueOnly.severity });
  if (issueOnly.rectificationStatus) and.push({ rectificationStatus: issueOnly.rectificationStatus });
  if (issueOnly.falseConfirmation) and.push({ falseConfirmation: issueOnly.falseConfirmation });
  const search = issueSearch(filters.q, labels);
  if (search) and.push(search);
  return { AND: and };
}

/**
 * Review queue narrowing: property and free text only. The queue is live work,
 * so the period never hides a job still waiting for review.
 */
export function queueJobNarrow(filters: QualityFilters): Prisma.JobWhereInput | undefined {
  const and: Prisma.JobWhereInput[] = [];
  if (filters.propertyId) and.push({ propertyId: filters.propertyId });
  const text = filters.q.trim();
  if (text) {
    const contains = { contains: text, mode: "insensitive" as const };
    and.push({
      OR: [
        { property: { name: contains } },
        { jobNumber: contains },
        { assignments: { some: { user: { name: contains } } } },
      ],
    });
  }
  return and.length ? { AND: and } : undefined;
}

export function cleanWhere(range: PeriodRange, filters: QualityFilters): Prisma.JobWhereInput {
  const and: Prisma.JobWhereInput[] = [
    { status: { in: SUBMITTED_JOB_STATUSES } },
    { scheduledDate: dateRange(range) },
  ];
  if (filters.propertyId) and.push({ propertyId: filters.propertyId });
  if (filters.cleanerId) and.push({ assignments: { some: { userId: filters.cleanerId } } });
  const text = filters.q.trim();
  if (text) {
    const contains = { contains: text, mode: "insensitive" as const };
    and.push({
      OR: [
        { property: { name: contains } },
        { jobNumber: contains },
        { assignments: { some: { user: { name: contains } } } },
      ],
    });
  }
  return { AND: and };
}
