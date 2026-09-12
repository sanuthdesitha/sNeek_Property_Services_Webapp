import { NextRequest, NextResponse } from "next/server";
import { requireJobsViewsContext } from "@/lib/jobs/views-context";
import { applyBulkStatus, BulkStatusError } from "@/lib/jobs/bulk-status-store";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function POST(req: NextRequest) {
  try {
    const identity = await requireJobsViewsContext();
    if (identity.readOnly) throw new BulkStatusError(403, "Read-only impersonation cannot change job status.");
    const body = await req.json().catch(() => null);
    const context = req.headers.get("x-jobs-view-context");
    if ((context !== null || body?.reviewToken) && context !== identity.context) throw new BulkStatusError(409, "Your account changed. Reload the page.");
    return NextResponse.json(await applyBulkStatus(identity.ownerId, body), { headers });
  } catch (error) {
    const status = error instanceof BulkStatusError ? error.status : error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : error instanceof Error && error.message === "FORBIDDEN" ? 403 : 503;
    return NextResponse.json({ error: error instanceof BulkStatusError ? error.message : "Could not confirm the bulk update. Refresh jobs before attempting another change." }, { status, headers });
  }
}
