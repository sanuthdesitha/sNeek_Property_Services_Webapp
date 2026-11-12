import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { requireRole } from "@/lib/auth/session";
import { isListQueryError, parseListQuery } from "@/lib/admin/list-query";
import { toCsv } from "@/lib/insights/csv";
import { exportLostFoundRows, LOST_FOUND_SORTS, parseLostFoundFilters } from "@/lib/lost-found/list";
import { lostFoundStatusLabel } from "@/lib/lost-found/status";

const HEADER = [
  "Item", "Found location", "Description", "Property", "Client", "Job", "Found (local)", "Reported by", "Status",
  "Days held", "Past holding period", "Stored at", "Guest", "Guest phone or contact", "Guest email", "Guest source",
  "Booking code", "Estimated value (AUD)", "Resolution", "Resolved (local)", "Photos",
];

function guestSourceLabel(source: string | null, jobHasBooking: boolean | null): string {
  if (source === "BOOKING") return "From booking";
  if (source === "MANUAL") return "Entered by office";
  if (jobHasBooking === false) return "No booking on job";
  return "Not recorded";
}

/** GET — CSV of every item matching the list's filters, in the list's order. */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const params = req.nextUrl.searchParams;
    const query = parseListQuery(params, { sortable: LOST_FOUND_SORTS, defaultSort: "found", defaultDir: "asc", defaultPageSize: 25, maxPageSize: 100 });
    const { rows, timeZone } = await exportLostFoundRows(parseLostFoundFilters(params), query);
    const local = (iso: string | null) => (iso ? formatInTimeZone(new Date(iso), timeZone, "yyyy-MM-dd HH:mm") : "");
    const csv = toCsv(HEADER, rows.map((row) => [
      row.itemName, row.foundLocation, row.description, row.propertyName, row.clientName, row.jobNumber, local(row.createdAt), row.reportedByName,
      lostFoundStatusLabel(row.status), row.holding.days, row.holding.counts ? (row.holding.past ? "Yes" : "No") : "",
      row.storageLocation, row.guestName, row.guestContact, row.guestEmail, guestSourceLabel(row.guestSource, row.jobHasBooking),
      row.booking?.reservationCode ?? "", row.estimatedValue, row.resolution, local(row.resolvedAt), row.photos.length,
    ]));
    const stamp = formatInTimeZone(new Date(), timeZone, "yyyy-MM-dd");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="lost-and-found-${stamp}.csv"`,
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
