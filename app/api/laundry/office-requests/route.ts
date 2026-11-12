import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { listOfficeRequestsForLaundryUser, OFFICE_REQUEST_WINDOW_HOURS, openRequestCount } from "@/lib/laundry/office-requests";
import type { OfficeRequestsResponse } from "@/lib/laundry/office-request-types";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * GET /api/laundry/office-requests — the signed-in laundry team member's
 * "From the office" inbox (lib/laundry/office-requests.ts). Office accounts
 * opening the laundry portal get an empty list: requests are addressed to
 * laundry logins only.
 */
export async function GET() {
  try {
    const session = await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
    const requests = await listOfficeRequestsForLaundryUser(session.user);
    const body: OfficeRequestsResponse = { requests, openCount: openRequestCount(requests), windowHours: OFFICE_REQUEST_WINDOW_HOURS };
    return NextResponse.json(body, { headers });
  } catch (error: unknown) {
    const status = getApiErrorStatus(error, 500);
    return NextResponse.json({ error: status === 500 ? "Requests from the office could not be loaded." : (error as Error).message }, { status, headers });
  }
}
