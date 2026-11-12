import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { jobsDateScopeRange } from "./date-scope";
import { notInvoicedJobSql } from "./invoiced-rule";
import { BUILT_IN_VIEWS, type BuiltInViewRule, type JobsViewCounts } from "./view-presets";

/**
 * Real totals for every built-in Jobs view in ONE grouped query
 * (`COUNT(*) FILTER (WHERE …)` per view). Each condition is generated from the
 * same declaration (`BUILT_IN_VIEWS`) that the tab applies as filters, and
 * mirrors `buildJobsWhere` for those fields:
 * - date: `scheduledDate` is a UTC date-only key, so a Sydney day range is
 *   `>= fromT00:00Z` and `< (to + 1 day)T00:00Z`;
 * - status: equality / membership;
 * - invoiced "no": no line on a live invoice (`invoiced-rule.ts`).
 *
 * Only for administrators and operations managers, who see every job.
 */
function dayStart(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function viewRuleSql(rule: BuiltInViewRule, now: Date): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (rule.dateScope) {
    const range = jobsDateScopeRange(rule.dateScope, now);
    if (range.dateFrom) parts.push(Prisma.sql`j."scheduledDate" >= ${dayStart(range.dateFrom)}`);
    if (range.dateTo) {
      const next = new Date(dayStart(range.dateTo).getTime() + 86_400_000);
      parts.push(Prisma.sql`j."scheduledDate" < ${next}`);
    }
  }
  if (rule.statuses && rule.statuses.length > 0) {
    parts.push(Prisma.sql`j."status"::text IN (${Prisma.join(rule.statuses)})`);
  } else {
    // As the list's where-builder: no status asked for = everything but cancelled.
    parts.push(Prisma.sql`j."status"::text <> 'CANCELLED'`);
  }
  if (rule.invoiced === "no") {
    parts.push(notInvoicedJobSql());
  }
  if (parts.length === 0) return Prisma.sql`TRUE`;
  return Prisma.join(parts, " AND ");
}

export function viewCountsSql(now: Date): Prisma.Sql {
  const columns = BUILT_IN_VIEWS.map(
    (view) => Prisma.sql`COUNT(*) FILTER (WHERE ${viewRuleSql(view.rule, now)})::int AS ${Prisma.raw(`"${view.id}"`)}`,
  );
  return Prisma.sql`SELECT ${Prisma.join(columns, ", ")} FROM "Job" j`;
}

type CountRow = Record<string, number | bigint | null>;

export async function loadJobViewCounts(now: Date = new Date()): Promise<JobsViewCounts> {
  const rows = await db.$queryRaw<CountRow[]>(viewCountsSql(now));
  const row = rows[0];
  if (!row) throw new Error("View counts unavailable.");
  const counts = {} as JobsViewCounts;
  for (const view of BUILT_IN_VIEWS) {
    const value = row[view.id];
    if (value === null || value === undefined) throw new Error("View counts unavailable.");
    counts[view.id] = Number(value);
  }
  return counts;
}
