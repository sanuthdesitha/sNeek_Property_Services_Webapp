import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { isJobsFilterError, parseStatusList } from "@/lib/jobs/list-filters";
import { loadCalendarRange, type CalendarFilters } from "@/lib/calendar/load";
import { isCalendarRangeError, parseCalendarRange } from "@/lib/calendar/range";

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

function readFilters(searchParams: URLSearchParams): CalendarFilters | string {
  const rows = searchParams.get("rows") ?? "cleaners";
  if (rows !== "cleaners" && rows !== "properties") return "rows must be cleaners or properties.";
  const clientId = searchParams.get("clientId");
  if (clientId !== null && clientId !== "" && !ID_PATTERN.test(clientId)) return "Invalid client.";
  return {
    rowsMode: rows,
    statuses: parseStatusList(searchParams.get("status")),
    clientId: clientId || null,
    unassignedOnly: searchParams.get("unassigned") === "1",
    includeLaundry: searchParams.get("laundry") === "1",
  };
}

/**
 * GET /api/admin/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD&rows=cleaners|properties
 *   [&status=A,B][&clientId=][&unassigned=1][&laundry=1]
 *
 * Only the asked-for calendar days (at most 45), in a slim shape, with the
 * rows, their hours, laundry counts per day and the range's summary counts.
 * Same roles as the calendar page; operations managers also pass the
 * Calendar permission through the session guard.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const range = parseCalendarRange(searchParams.get("start"), searchParams.get("end"));
    const filters = readFilters(searchParams);
    if (typeof filters === "string") return NextResponse.json({ error: filters }, { status: 400 });
    const body = await loadCalendarRange(range, filters);
    return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err: unknown) {
    if (isCalendarRangeError(err) || isJobsFilterError(err)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not load the calendar." : message }, { status });
  }
}
