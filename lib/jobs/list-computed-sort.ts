import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { JOB_INCLUDE } from "./list-include";
import { chargeForJob, guestInForJob, loadChargeInputs } from "./list-row-extras";
import { buildJobsOrderBy, isComputedJobsOrder, type JobsComputedOrder, type JobsListOrder } from "./list-sort";
import { compareComputedRows, guestInSortValue, type ComputedSortRow } from "./list-computed-order";

/**
 * Server-side ordering for the three Jobs columns that are not database
 * columns. Each orders the WHOLE filtered set before the page is cut, so page
 * 2 continues page 1:
 *
 * - Cleaner: the primary (else the earliest-assigned) active cleaner's name,
 *   in one SQL query over the filtered ids. Unassigned jobs come FIRST in both
 *   directions (they are the ones that need attention).
 * - Guest in: the arriving guest's check-in from `jobMeta.reservationContext`.
 *   The notes are a TEXT column holding JSON (old rows hold plain text), so a
 *   SQL JSON cast could fail the whole list on one bad row; the set is read and
 *   parsed with the same `guestInForJob` the column shows. Nulls last.
 * - Charge: `computeClientCharge` over the stored rates (the column's rule).
 *   Jobs with no rate sort last and still show "No rate".
 *
 * Guest in and Charge read the filtered set in one bounded pass and refuse a
 * set above `COMPUTED_SORT_CAP` (400, asking to narrow the filters) instead of
 * sorting only the visible page.
 */
export const COMPUTED_SORT_CAP = 5_000;

export class JobsSortTooLargeError extends Error {
  readonly status = 400;
  readonly code = "SORT_SET_TOO_LARGE";
  constructor(readonly total: number) {
    super(`Sorting by this column covers at most ${COMPUTED_SORT_CAP.toLocaleString("en-AU")} jobs and ${total.toLocaleString("en-AU")} match. Narrow the date or filters, or sort by another column.`);
    this.name = "JobsSortTooLargeError";
  }
}

export function isJobsSortTooLargeError(error: unknown): error is JobsSortTooLargeError {
  return error instanceof JobsSortTooLargeError;
}

type Where = Record<string, unknown>;
type IdRow = { id: string };

/** SQL for one page of the Cleaner sort over a known id set. Exported for tests. */
export function cleanerOrderSql(ids: string[], dir: "asc" | "desc", skip: number, take: number): Prisma.Sql {
  const direction = dir === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  return Prisma.sql`
    SELECT j.id
    FROM "Job" j
    LEFT JOIN LATERAL (
      SELECT lower(COALESCE(NULLIF(btrim(u.name), ''), u.email)) AS sort_name
      FROM "JobAssignment" a
      JOIN "User" u ON u.id = a."userId"
      WHERE a."jobId" = j.id AND a."removedAt" IS NULL
      ORDER BY a."isPrimary" DESC, a."assignedAt" ASC, a.id ASC
      LIMIT 1
    ) c ON TRUE
    WHERE j.id = ANY(${ids}::text[])
    ORDER BY (c.sort_name IS NULL) DESC, c.sort_name ${direction}, j."scheduledDate" ASC, j.id ASC
    OFFSET ${skip} LIMIT ${take}`;
}

async function cleanerPageIds(where: Where, dir: "asc" | "desc", skip: number, take: number): Promise<string[]> {
  const filtered = await db.job.findMany({ where, select: { id: true } });
  if (filtered.length === 0) return [];
  const rows = await db.$queryRaw<IdRow[]>(cleanerOrderSql(filtered.map((row) => row.id), dir, skip, take));
  return rows.map((row) => row.id);
}

async function guestInRows(where: Where): Promise<ComputedSortRow[]> {
  const rows = await db.job.findMany({
    where,
    select: { id: true, scheduledDate: true, internalNotes: true, sameDayCheckin: true },
    take: COMPUTED_SORT_CAP + 1,
  });
  if (rows.length > COMPUTED_SORT_CAP) throw new JobsSortTooLargeError(rows.length);
  return rows.map((row) => ({ id: row.id, dayMs: row.scheduledDate.getTime(), value: guestInSortValue(guestInForJob(row)) }));
}

async function chargeRows(where: Where): Promise<ComputedSortRow[]> {
  const rows = await db.job.findMany({
    where,
    select: { id: true, scheduledDate: true, jobType: true, propertyId: true, fixedPrice: true },
    take: COMPUTED_SORT_CAP + 1,
  });
  if (rows.length > COMPUTED_SORT_CAP) throw new JobsSortTooLargeError(rows.length);
  const inputs = await loadChargeInputs(rows);
  return rows.map((row) => ({ id: row.id, dayMs: row.scheduledDate.getTime(), value: chargeForJob(row, inputs).amount }));
}

/** The ids of one page in computed order. `totalCount` lets the cap refuse before any read. */
export async function computedPageIds(where: Where, order: JobsComputedOrder, skip: number, take: number, totalCount: number): Promise<string[]> {
  if (order.key === "cleaner") return cleanerPageIds(where, order.dir, skip, take);
  if (totalCount > COMPUTED_SORT_CAP) throw new JobsSortTooLargeError(totalCount);
  const rows = order.key === "guestIn" ? await guestInRows(where) : await chargeRows(where);
  return [...rows].sort((a, b) => compareComputedRows(a, b, order.dir)).slice(skip, skip + take).map((row) => row.id);
}

type PageRequest = { where: Where; order: JobsListOrder | null; statusGroup: string | null; skip: number; take: number; totalCount: number };

/**
 * One page of list rows (JOB_INCLUDE) in the requested order: Prisma order for
 * database columns, the computed order above for Cleaner, Guest in and Charge.
 */
export async function findJobsPage(request: PageRequest) {
  const { where, order, skip, take } = request;
  if (!isComputedJobsOrder(order)) {
    return db.job.findMany({ where, include: JOB_INCLUDE, orderBy: buildJobsOrderBy(order, request.statusGroup), skip, take });
  }
  const ids = await computedPageIds(where, order, skip, take, request.totalCount);
  if (ids.length === 0) return [];
  const rows = await db.job.findMany({ where: { id: { in: ids } }, include: JOB_INCLUDE });
  const position = new Map(ids.map((id, index) => [id, index]));
  return rows.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
}
