import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { holidayRateWorkspace, saveHolidayPolicy, saveHolidayCalendar, refreshNswHolidayCalendar, previewHolidayJob, applyHolidayJob, revertHolidayJob } from "@/lib/finance/holiday-rates";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
function failure(error: unknown) { const message = error instanceof Error ? error.message : "Holiday rate request failed"; return json({ error: message }, message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : /CONFLICT|already applied/.test(message) ? 409 : 400); }
export async function GET(req: NextRequest) {
  try { const session = await requireRole(["ADMIN"]); return json(await holidayRateWorkspace(session.user.id, req.nextUrl.searchParams.get("jobId") || undefined)); }
  catch (error) { return failure(error); }
}
export async function POST(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || req.nextUrl.host;
  const protocol = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.nextUrl.protocol.replace(":", "");
  if (!["http", "https"].includes(protocol) || req.headers.get("origin") !== `${protocol}://${host}`) return json({ error: "Same-origin request required" }, 403);
  try {
    const session = await requireRole(["ADMIN"]); const { action, ...input } = await req.json();
    if (action === "policy") return json(await saveHolidayPolicy(session.user.id, input.policy, input.reason));
    if (action === "calendar") return json(await saveHolidayCalendar(session.user.id, input.calendar, input.reason));
    if (action === "refresh") return json(await refreshNswHolidayCalendar(session.user.id));
    if (action === "preview") return json(await previewHolidayJob(session.user.id, input));
    if (action === "apply") return json(await applyHolidayJob(session.user.id, input));
    if (action === "revert") return json(await revertHolidayJob(session.user.id, input.jobId, input.snapshotId, input.reason));
    return json({ error: "Unknown action" }, 400);
  } catch (error) { return failure(error); }
}
