/**
 * GET /api/admin/job-evidence-overrides?jobId=… — the "Camera not working"
 * requests on one job for its job page (cleaner job flow v2, item 2).
 *
 * ADMIN, or OPS_MANAGER with the Approvals pack (read), on the live session:
 * requireRole → requireSession → enforceOpsRequest re-reads the operations
 * policy on this request (this path maps to "approvals" in
 * lib/rbac/ops-catalog.ts). Operations managers have no per-job scope.
 */
import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { listEvidenceOverridesForOffice } from "@/lib/jobs/evidence-override";

const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
    if (!jobId) return NextResponse.json({ error: "Choose a job.", code: "INVALID_INPUT" }, { status: 400, headers: privateHeaders });
    const [requests, settings] = await Promise.all([listEvidenceOverridesForOffice(jobId), getAppSettings().catch(() => null)]);
    return NextResponse.json({ jobId, requests, timeZone: settings?.timezone ?? "Australia/Sydney" }, { headers: privateHeaders });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in again.", code: "UNAUTHORIZED" }, { status: 401, headers: privateHeaders });
    if (message === "FORBIDDEN") return NextResponse.json({ error: "You cannot see this.", code: "FORBIDDEN" }, { status: 403, headers: privateHeaders });
    return NextResponse.json({ error: "Could not load the requests.", code: "FAILED" }, { status: 500, headers: privateHeaders });
  }
}
