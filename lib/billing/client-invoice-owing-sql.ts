/**
 * "Owing" as an SQL expression, so the list can sort the whole filtered set by
 * it (Wave D). It mirrors lib/finance/receivables exactly:
 *
 *   invoiceAmountOwing = max(0, totalAmount − paidAmount − creditedAmount)
 *   creditedAmount     = round2( Σ |totalAmount| of credit notes linked by
 *                        creditsInvoiceId whose status is APPROVED or SENT )
 *   a credit note's own row owes 0 (the list shows "—").
 *
 * paidAmount is a column (the cumulative amount received, kept by every
 * payment path), not the metadata ledger, and credits are rows, so the figure
 * is reliable in SQL without a stored column. A parity test runs this
 * expression and the TypeScript function over the same fixtures
 * (tests/db/money-wave-d.test.ts).
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { CREDIT_REDUCING_STATUSES } from "@/lib/finance/receivables";

const REDUCING = Prisma.join(CREDIT_REDUCING_STATUSES.map((status) => Prisma.sql`${status}`));

/** SQL for the owing of the invoice aliased `i`. */
export function owingSql(alias = "i"): Prisma.Sql {
  const i = Prisma.raw(`"${alias.replace(/"/g, "")}"`);
  return Prisma.sql`CASE WHEN ${i}."kind"::text = 'CREDIT_NOTE' THEN 0::double precision ELSE GREATEST(0::double precision,
    COALESCE(${i}."totalAmount", 0) - COALESCE(${i}."paidAmount", 0) - COALESCE((
      SELECT ROUND(SUM(ABS(COALESCE(cn."totalAmount", 0)))::numeric, 2)::double precision
      FROM "ClientInvoice" cn
      WHERE cn."creditsInvoiceId" = ${i}."id" AND cn."status"::text IN (${REDUCING})
    ), 0)) END`;
}

/** Upper bound on the filtered set sorted by owing in one request; larger sets are refused, not cut. */
export const OWING_SORT_MAX_ROWS = 20_000;

/**
 * One page of ids from `ids` (the whole filtered set), ordered by owing, with
 * the id as tiebreaker so paging is stable.
 */
export async function pageIdsByOwing(input: {
  ids: readonly string[];
  dir: "asc" | "desc";
  skip: number;
  take: number;
}): Promise<string[]> {
  if (input.ids.length === 0) return [];
  const direction = Prisma.raw(input.dir === "asc" ? "ASC" : "DESC");
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT i."id" FROM "ClientInvoice" i
    WHERE i."id" = ANY(${[...input.ids]}::text[])
    ORDER BY ${owingSql("i")} ${direction}, i."id" ASC
    OFFSET ${input.skip} LIMIT ${input.take}`;
  return rows.map((row) => row.id);
}

/** The SQL owing per id (for the parity test and diagnostics). */
export async function owingByIdSql(ids: readonly string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db.$queryRaw<Array<{ id: string; owing: number }>>`
    SELECT i."id", ${owingSql("i")} AS "owing" FROM "ClientInvoice" i WHERE i."id" = ANY(${[...ids]}::text[])`;
  return new Map(rows.map((row) => [row.id, Number(row.owing)]));
}
