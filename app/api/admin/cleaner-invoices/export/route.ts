import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { isListQueryError } from "@/lib/admin/list-query";
import { cleanerInvoicesCsv, listCleanerInvoicesForExport, parseCleanerInvoiceFilters } from "@/lib/cleaner/invoice-admin-list";

export const dynamic = "force-dynamic";

/** CSV of the selected payee invoices (`ids=a,b`) or everything matching the list filters. */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const params = new URL(req.url).searchParams;
    const ids = params.get("ids")?.split(",").map((id) => id.trim()).filter(Boolean).slice(0, 500) ?? null;
    const rows = await listCleanerInvoicesForExport({ filters: parseCleanerInvoiceFilters(params), ids: ids && ids.length ? ids : null });
    return new NextResponse(cleanerInvoicesCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="cleaner-invoices-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err: unknown) {
    if (isListQueryError(err)) return NextResponse.json({ error: err.message }, { status: 400 });
    const message = err instanceof Error && err.message ? err.message : "Could not export invoices.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
