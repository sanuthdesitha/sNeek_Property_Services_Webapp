import { NextRequest, NextResponse } from "next/server";
import { parseListQuery } from "@/lib/admin/list-query";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { registerCanLog } from "@/lib/quality/register/access";
import { readRegisterRequest, registerErrorResponse, requireRegisterViewer } from "@/lib/quality/register/http";
import { logRegisterIssue } from "@/lib/quality/register/log-issue";
import { REGISTER_SORTS } from "@/lib/quality/register/model";
import { buildRegisterResponse } from "@/lib/quality/register/service";

export const dynamic = "force-dynamic";

/**
 * All issues register (pilot "All issues register"): issues from every source
 * for the period and filters, with figures, one page at a time. ADMIN and
 * OPS_MANAGER (quality pack); each source only where the viewer's packs
 * include it. 409 PILOT_OFF where the pilot is off for this person.
 */
export async function GET(req: NextRequest) {
  try {
    const viewer = await requireRegisterViewer();
    const params = req.nextUrl.searchParams;
    const query = parseListQuery(params, { sortable: REGISTER_SORTS, defaultSort: "date", defaultDir: "desc", defaultPageSize: 25, maxPageSize: 100 });
    return NextResponse.json(await buildRegisterResponse(readRegisterRequest(params, viewer.allowed), query));
  } catch (error) {
    return registerErrorResponse(error, "Could not load the issues register.");
  }
}

/**
 * Log a client complaint or an office-noticed issue by hand (an internal case;
 * never shown to the client, no message sent). ADMIN, or OPS_MANAGER whose
 * quality and cases packs are at manage. Refused while testing as someone.
 */
export async function POST(req: NextRequest) {
  try {
    const viewer = await requireRegisterViewer();
    if (viewer.session.impersonation) {
      return NextResponse.json({ error: "Issues cannot be logged while testing as someone." }, { status: 403 });
    }
    const levels = await getOpsAccess(viewer.session.user);
    if (!registerCanLog(levels)) {
      return NextResponse.json({ error: "Logging an issue needs the Quality and Cases permissions at manage." }, { status: 403 });
    }
    const result = await logRegisterIssue({ id: viewer.session.user.id, role: viewer.session.user.role }, await req.json());
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return registerErrorResponse(error, "Could not log the issue.");
  }
}
