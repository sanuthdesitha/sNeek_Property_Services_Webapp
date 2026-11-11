/**
 * Database readers for Insights. Each read is bounded by the period (at most
 * MAX_PERIOD_DAYS, plus the previous period) and selects only the columns the
 * figures need; issue counts are grouped in the database.
 *
 * The clean set is the Quality hub's (`cleanWhere`: submitted, QA review,
 * completed or invoiced jobs scheduled in the period), so "cleans" means the
 * same thing on both pages. A client filter narrows to that client's
 * properties.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { loadCategoryLabels } from "@/lib/quality/facts";
import { EMPTY_QUALITY_FILTERS } from "@/lib/quality/types";
import { cleanWhere, issueWhere } from "@/lib/quality/where";
import type { PeriodRange } from "@/lib/quality/period";
import { deriveJobFact, type FactContext, type InsightsJobRow, type JobFact } from "./job-facts";
import { InsightsQueryError } from "./period";

/** A safety cap on one read. A period that hits it is refused rather than half-counted. */
export const MAX_CLEANS_PER_READ = 20_000;

export type InsightsFilters = { clientId: string };

const JOB_SELECT = {
  id: true,
  jobNumber: true,
  scheduledDate: true,
  startTime: true,
  jobType: true,
  estimatedHours: true,
  fixedPrice: true,
  isRework: true,
  reworkPayAmount: true,
  internalNotes: true,
  cleanSkipStatus: true,
  propertyId: true,
  property: { select: { name: true, clientId: true, client: { select: { name: true } } } },
  assignments: {
    select: {
      userId: true,
      payRate: true,
      removedAt: true,
      user: { select: { name: true, email: true, role: true, hourlyRate: true } },
    },
  },
  timeLogs: { select: { userId: true, startedAt: true, stoppedAt: true, durationM: true } },
  payAdjustments: { select: { id: true, cleanerId: true, status: true, requestedAmount: true, approvedAmount: true } },
  qaReviews: { select: { score: true, kind: true, rating: true, managementReview: true, createdAt: true } },
  reworkOfJob: { select: { assignments: { select: { userId: true, removedAt: true } } } },
} satisfies Prisma.JobSelect;

function clientJobWhere(filters: InsightsFilters): Prisma.JobWhereInput {
  return filters.clientId ? { property: { clientId: filters.clientId } } : {};
}

function clientIssueWhere(filters: InsightsFilters): Prisma.QaIssueWhereInput {
  return filters.clientId ? { property: { clientId: filters.clientId } } : {};
}

async function loadFactContext(propertyIds: string[]): Promise<FactContext> {
  const [settings, propertyRates, priceBook] = await Promise.all([
    getAppSettings(),
    propertyIds.length
      ? db.propertyClientRate.findMany({
          where: { propertyId: { in: propertyIds }, isActive: true },
          select: { propertyId: true, jobType: true, baseCharge: true, defaultDescription: true },
        })
      : Promise.resolve([]),
    db.priceBook.findMany({ where: { isActive: true }, select: { jobType: true, baseRate: true } }),
  ]);
  return {
    rates: { propertyRates, priceBook },
    cleanerJobHourlyRates: settings.cleanerJobHourlyRates ?? {},
  };
}

/** Cleans scheduled in `range`, reduced to facts. */
export async function loadJobFacts(range: PeriodRange, filters: InsightsFilters): Promise<JobFact[]> {
  const rows = await db.job.findMany({
    where: { AND: [cleanWhere(range, EMPTY_QUALITY_FILTERS), clientJobWhere(filters)] },
    select: JOB_SELECT,
    orderBy: [{ scheduledDate: "asc" }, { id: "asc" }],
    take: MAX_CLEANS_PER_READ + 1,
  });
  if (rows.length > MAX_CLEANS_PER_READ) {
    throw new InsightsQueryError("There are too many cleans in this period to analyse at once. Choose a shorter period.");
  }
  const context = await loadFactContext(Array.from(new Set(rows.map((row) => row.propertyId))));
  return rows.map((row) => deriveJobFact(row as InsightsJobRow, context));
}

export type IssueCounts = {
  total: number;
  byProperty: Map<string, number>;
  byCleaner: Map<string, number>;
  byCategory: Map<string, number>;
};

/**
 * QaIssue counts raised in `range` (the Quality hub's issue period rule:
 * created in the period). Without a client filter, the per-cleaner totals
 * equal the Quality hub's Cleaners tab issue column for the same period.
 */
export async function loadIssueCounts(range: PeriodRange, filters: InsightsFilters): Promise<IssueCounts> {
  const labels = await loadCategoryLabels();
  const where: Prisma.QaIssueWhereInput = { AND: [issueWhere(range, EMPTY_QUALITY_FILTERS, labels), clientIssueWhere(filters)] };
  const [byProperty, byCleaner, byCategory] = await Promise.all([
    db.qaIssue.groupBy({ by: ["propertyId"], where, _count: { _all: true } }),
    db.qaIssue.groupBy({ by: ["cleanerId"], where, _count: { _all: true } }),
    db.qaIssue.groupBy({ by: ["category"], where, _count: { _all: true } }),
  ]);
  const toMap = <K extends string>(rows: Array<Record<K, string> & { _count: { _all: number } }>, key: K) =>
    new Map(rows.map((row) => [row[key], row._count._all]));
  const properties = toMap(byProperty, "propertyId");
  return {
    total: Array.from(properties.values()).reduce((total, count) => total + count, 0),
    byProperty: properties,
    byCleaner: toMap(byCleaner, "cleanerId"),
    byCategory: toMap(byCategory, "category"),
  };
}

export async function loadCategoryLabelMap(): Promise<Map<string, string>> {
  return loadCategoryLabels();
}

export type PersonName = { id: string; name: string };

export async function loadPeopleNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((row) => [row.id, row.name ?? row.email ?? "Cleaner"]));
}

export async function loadClientOptions(): Promise<PersonName[]> {
  const rows = await db.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" }, take: 2000 });
  return rows.map((row) => ({ id: row.id, name: row.name }));
}
