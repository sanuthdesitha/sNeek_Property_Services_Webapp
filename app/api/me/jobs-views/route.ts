import { NextRequest, NextResponse } from "next/server";
import { requireJobsViewsContext } from "@/lib/jobs/views-context";
import { JobsViewsError, mutateJobsViews, readJobsViews } from "@/lib/jobs/saved-views-store";

export const dynamic = "force-dynamic";
async function handle(req: NextRequest, write: boolean) {
  try {
    const identity = await requireJobsViewsContext();
    if (req.headers.get("x-jobs-view-context") !== identity.context) {
      throw new JobsViewsError(409, "CONTEXT_CHANGED", "Your account context changed. Reload this page before using saved views.");
    }
    // Middleware remains authoritative; direct handler invocation also fails closed.
    if (write && identity.readOnly) throw new JobsViewsError(403, "IMPERSONATION_READ_ONLY", "Saved views cannot be changed in a read-only test session.");
    let body: unknown;
    if (write) {
      try { body = await req.json(); }
      catch { throw new JobsViewsError(400, "INVALID_INPUT", "Invalid saved view request."); }
    }
    const data = write ? await mutateJobsViews(identity.ownerId, body) : await readJobsViews(identity.ownerId);
    return NextResponse.json({ context: identity.context, data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = error instanceof JobsViewsError ? error.status : message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({
      code: error instanceof JobsViewsError ? error.code : status === 500 ? "STORAGE_ERROR" : message,
      error: error instanceof JobsViewsError ? error.message : status === 500 ? "Saved views are unavailable. Retry your request." : "Saved views access denied.",
    }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
export const GET = (req: NextRequest) => handle(req, false);
export const PATCH = (req: NextRequest) => handle(req, true);
