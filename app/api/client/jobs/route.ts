import { NextResponse } from "next/server";
import { requireClientPortal } from "@/lib/auth/client-portal";
import { isClientModuleEnabled } from "@/lib/portal-access";
import { listClientJobsForUser } from "@/lib/client/portal-data";

export async function GET() {
  try {
    // Reading the schedule is core portal access, so no extra VA grant is
    // required — but the list is still narrowed to the team's property scope
    // inside the data layer, so a scoped VA never sees the whole portfolio.
    const portal = await requireClientPortal();
    if (!isClientModuleEnabled(portal.visibility, "jobs")) {
      return NextResponse.json({ error: "Jobs are hidden for this client." }, { status: 403 });
    }
    const jobs = await listClientJobsForUser(portal.userId);
    return NextResponse.json(jobs);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not load jobs." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
