import { NextRequest, NextResponse } from "next/server";
import { requireJobsViewsContext } from "@/lib/jobs/views-context";
import { previewBulkStatus, BulkStatusError } from "@/lib/jobs/bulk-status-store";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function GET(request: NextRequest) {
  try {
    const identity = await requireJobsViewsContext();
    if (request.headers.get("x-jobs-view-context") !== identity.context) throw new BulkStatusError(409, "Your account changed. Reload the page.");
    const params = request.nextUrl.searchParams;
    let jobIds: unknown;
    try { jobIds = JSON.parse(params.get("jobIds") ?? "null"); } catch { throw new BulkStatusError(400, "Invalid selection."); }
    const result = await previewBulkStatus({ jobIds, status: params.get("status") });
    return NextResponse.json({ ...result, context: identity.context }, { headers });
  } catch (error) {
    const status = error instanceof BulkStatusError ? error.status : error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : error instanceof Error && error.message === "FORBIDDEN" ? 403 : 503;
    return NextResponse.json({ error: error instanceof BulkStatusError ? error.message : "Could not load the preview. Try again." }, { status, headers });
  }
}
