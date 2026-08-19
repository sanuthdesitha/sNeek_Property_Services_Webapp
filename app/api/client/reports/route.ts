import { NextResponse } from "next/server";
import { propertyScopeWhere, requireClientPortal } from "@/lib/auth/client-portal";
import { db } from "@/lib/db";
import { isClientModuleEnabled } from "@/lib/portal-access";
import { getApiErrorStatus } from "@/lib/api/http";

export async function GET() {
  try {
    // Chokepoint: role, client, the "reports" grant, and MERGED visibility —
    // the old raw-settings check ignored per-client overrides (the exact
    // resolution drift the 2026-08-15 audit kept finding).
    const portal = await requireClientPortal({ permission: "reports" });
    if (!isClientModuleEnabled(portal.visibility, "reports")) {
      return NextResponse.json({ error: "Reports are not available for client users." }, { status: 403 });
    }

    const reports = await db.report.findMany({
      where: {
        // Only reports an admin explicitly published to the client. Without this
        // a client could pull reports marked clientVisible=false (incl. their
        // embedded QA/notes HTML). Gate on clientVisible ALONE — a Report row
        // only exists once the cleaner submits, and the old job.status IN
        // (COMPLETED, INVOICED) arm hid finished reports still in SUBMITTED/
        // QA_REVIEW.
        clientVisible: true,
        job: {
          property: propertyScopeWhere(portal),
        },
      },
      // Return only client-safe fields (no internal columns).
      select: {
        id: true,
        jobId: true,
        pdfUrl: true,
        htmlContent: true,
        clientVisible: true,
        createdAt: true,
        job: {
          select: {
            scheduledDate: true,
            jobType: true,
            property: { select: { name: true, suburb: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(reports);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: getApiErrorStatus(err) });
  }
}
