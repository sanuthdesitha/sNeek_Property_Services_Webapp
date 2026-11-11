import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { isListQueryError, parseListQuery, readQueryValue } from "@/lib/admin/list-query";
import {
  clientInvoicesCsv,
  listClientInvoicesForExport,
  parseClientInvoiceFilters,
} from "@/lib/billing/client-invoice-list";
import { CLIENT_INVOICE_BULK_MAX_IDS, CLIENT_INVOICE_SORTS } from "@/lib/billing/client-invoice-list-types";

const MAX_EXPORT_IDS = CLIENT_INVOICE_BULK_MAX_IDS * 4;

function parseIds(raw: string | undefined): string[] | null {
  if (!raw) return null;
  const ids = Array.from(new Set(raw.split(",").map((id) => id.trim()).filter(Boolean)));
  if (ids.length > MAX_EXPORT_IDS || ids.some((id) => id.length > 64)) {
    throw new Error(`Export at most ${MAX_EXPORT_IDS} selected invoices at a time.`);
  }
  return ids;
}

/**
 * GET → text/csv of the selected invoices (?ids=a,b) or of everything matching
 * the list filters. Read-only; uses the same filter parser as the list.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const params = req.nextUrl.searchParams;
    const query = parseListQuery(params, {
      sortable: CLIENT_INVOICE_SORTS,
      defaultSort: "created",
      defaultDir: "desc",
    });
    const filters = parseClientInvoiceFilters(params);
    const rows = await listClientInvoicesForExport({
      filters,
      ids: parseIds(readQueryValue(params, "ids")),
      sort: query.sort,
      dir: query.dir,
    });
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(clientInvoicesCsv(rows), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="client-invoices-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not export invoices.";
    const status = isListQueryError(err) ? 400 : message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
