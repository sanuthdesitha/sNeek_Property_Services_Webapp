import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { requireRole } from "@/lib/auth/session";
import { isListQueryError, parseListQuery } from "@/lib/admin/list-query";
import { toCsv } from "@/lib/insights/csv";
import { getAppSettings } from "@/lib/settings";
import { PORTFOLIO_SORTS, sizeLabel } from "@/lib/properties/portfolio-options";
import { parsePortfolioFilters } from "@/lib/properties/portfolio-rules";
import { buildPortfolioRows, filterAndSortRows } from "@/lib/properties/portfolio-list";
import { calendarLabel, flagLabels, nextCleanLabel, qaBasis, qaLabel } from "@/lib/properties/portfolio-format";

const HEADER = ["Property", "Client", "Suburb", "Address", "Size", "Calendar", "Next clean", "Next job", "QA, 30 d", "QA basis", "Flags", "Jobs, all time", "One-off site"];
const MAX_IDS = 500;

/**
 * GET — CSV of the Properties list: every row matching the list's filters in
 * the list's order, or only `ids` (comma separated, the bulk bar's selection).
 * A withheld QA score is written as "Not enough data", never 0.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const params = req.nextUrl.searchParams;
    const query = parseListQuery(params, { sortable: PORTFOLIO_SORTS, defaultSort: "name", defaultDir: "asc", defaultPageSize: 25, maxPageSize: 100 });
    const filters = parsePortfolioFilters(params);
    const ids = (params.get("ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
    if (ids.length > MAX_IDS) return NextResponse.json({ error: `Export at most ${MAX_IDS} selected properties.` }, { status: 400 });

    const now = new Date();
    const { rows } = await buildPortfolioRows({ includeOneOff: filters.includeOneOff || ids.length > 0, ids: ids.length > 0 ? ids : undefined }, now);
    const ordered = ids.length > 0 ? filterAndSortRows(rows, { ...filters, q: "", clientId: "", suburb: "", chip: null }, query.sort, query.dir) : filterAndSortRows(rows, filters, query.sort, query.dir);
    const csv = toCsv(
      HEADER,
      ordered.map((row) => [
        row.name,
        row.clientName,
        row.suburb,
        row.address,
        sizeLabel(row.bedrooms, row.bathrooms),
        calendarLabel(row.calendar, now).text,
        nextCleanLabel(row.nextClean, now),
        row.nextClean?.jobNumber ?? "",
        qaLabel(row.qa),
        qaBasis(row.qa),
        flagLabels(row.flags),
        row.jobCount,
        row.oneOff ? "Yes" : "No",
      ]),
    );
    const timeZone = (await getAppSettings()).timezone || "Australia/Sydney";
    const stamp = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="properties-${stamp}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (isListQueryError(err)) return NextResponse.json({ error: err.message }, { status: 400 });
    const message = err instanceof Error ? err.message : "Export failed.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
