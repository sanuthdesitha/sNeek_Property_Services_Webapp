import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { isListQueryError, parseListQuery } from "@/lib/admin/list-query";
import {
  cleanerInvoicePayees,
  cleanerInvoiceStats,
  listCleanerInvoices,
  parseCleanerInvoiceFilters,
  withPayees,
} from "@/lib/cleaner/invoice-admin-list";
import { CLEANER_INVOICE_SORTS } from "@/lib/cleaner/invoice-admin-list-types";

export const dynamic = "force-dynamic";

/**
 * Payee-submitted invoices (cleaners AND QA inspectors) for admin review.
 *
 *  - `?paginated=1` → `{ rows, total, page, pageSize, pageCount, sort, dir, counts }`
 *    with status / cleaner / from / to / q filters (the redesigned tab).
 *  - `?view=stats` → the four stat cards; `?view=context` → payees for the filter.
 *  - no parameters → the original response, unchanged: the newest 200 rows as a
 *    bare array (the classic /admin/cleaner-invoices screen still reads it).
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const params = new URL(req.url).searchParams;
    const view = params.get("view");
    if (view === "stats") return NextResponse.json(await cleanerInvoiceStats());
    if (view === "context") return NextResponse.json({ payees: await cleanerInvoicePayees() });
    if (params.get("paginated") === "1") {
      const query = parseListQuery(params, { sortable: CLEANER_INVOICE_SORTS, defaultSort: "submitted", defaultDir: "desc" });
      return NextResponse.json(await listCleanerInvoices({ query, filters: parseCleanerInvoiceFilters(params) }));
    }
    const rows = await db.cleanerInvoiceSubmission.findMany({ orderBy: [{ createdAt: "desc" }], take: 200 });
    return NextResponse.json(await withPayees(rows));
  } catch (err: unknown) {
    if (isListQueryError(err)) return NextResponse.json({ error: err.message }, { status: 400 });
    const message = err instanceof Error && err.message ? err.message : "Could not list submitted invoices.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
