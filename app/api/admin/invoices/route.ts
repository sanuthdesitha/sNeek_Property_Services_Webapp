import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { listInvoiceContext, listInvoiceFormContext } from "@/lib/billing/client-invoices";
import { isListQueryError, parseListQuery } from "@/lib/admin/list-query";
import { listClientInvoices, parseClientInvoiceFilters } from "@/lib/billing/client-invoice-list";
import { getClientInvoiceStats } from "@/lib/billing/client-invoice-stats";
import { CLIENT_INVOICE_SORTS } from "@/lib/billing/client-invoice-list-types";

function errorStatus(error: unknown): number {
  if (isListQueryError(error)) return 400;
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") return 401;
  if (message === "FORBIDDEN") return 403;
  return 400;
}

/**
 * Three shapes, chosen by query:
 *   ?paginated=1  → { rows, total, page, pageSize, pageCount, sort, dir, counts }
 *                   server paging, sorting and filters (the Estate list).
 *   ?view=context → { clients, properties } for the generator and filters.
 *   ?view=stats   → the four figures above the table (lib/billing/client-invoice-stats).
 *   (neither)     → the original { clients, properties, rates, invoices } with
 *                   the newest 100 invoices, kept for the classic admin screen.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const params = req.nextUrl.searchParams;
    const paginated = params.get("paginated");
    if (paginated === "1" || paginated === "true") {
      const query = parseListQuery(params, {
        sortable: CLIENT_INVOICE_SORTS,
        defaultSort: "created",
        defaultDir: "desc",
        defaultPageSize: 25,
        maxPageSize: 100,
      });
      const filters = parseClientInvoiceFilters(params);
      return NextResponse.json(await listClientInvoices({ query, filters }));
    }
    if (params.get("view") === "stats") {
      return NextResponse.json(await getClientInvoiceStats());
    }
    if (params.get("view") === "context") {
      return NextResponse.json(await listInvoiceFormContext());
    }
    return NextResponse.json(await listInvoiceContext());
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not load invoices.";
    return NextResponse.json({ error: message }, { status: errorStatus(err) });
  }
}
