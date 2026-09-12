import { NextRequest, NextResponse } from "next/server";
import { requireJobsViewsContext } from "@/lib/jobs/views-context";
import { JobsViewsError } from "@/lib/jobs/saved-views-store";
import { publishJobsTeamDefault, readJobsTeamDefault } from "@/lib/jobs/team-default-store";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
async function handle(request: NextRequest, write: boolean) {
  try {
    const identity = await requireJobsViewsContext();
    if (request.headers.get("x-jobs-view-context") !== identity.context) throw new JobsViewsError(409, "CONTEXT_CHANGED", "Your account changed. Reload the page.");
    if (write && !identity.canPublishTeamDefault) throw new JobsViewsError(403, "FORBIDDEN", "Only an administrator outside impersonation can publish the team default.");
    const data = write ? await publishJobsTeamDefault(identity.ownerId, await request.json().catch(() => null)) : await readJobsTeamDefault();
    return NextResponse.json({ context: identity.context, canPublish: identity.canPublishTeamDefault, data }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = error instanceof JobsViewsError ? error.status : message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ code: error instanceof JobsViewsError ? error.code : "TEAM_DEFAULT_ERROR", error: error instanceof JobsViewsError ? error.message : "Team default unavailable. Reload and try again." }, { status, headers });
  }
}
export const GET = (request: NextRequest) => handle(request, false);
export const PATCH = (request: NextRequest) => handle(request, true);
