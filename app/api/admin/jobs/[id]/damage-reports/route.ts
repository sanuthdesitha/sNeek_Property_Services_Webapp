import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { highestDamageSeverity } from "@/lib/damage/severity";

/**
 * D4 — the damage reports filed against one job, for the Forms & QA centre.
 *
 * A summary only: enough to list them, badge their severity and link through to
 * the investigation page. Deliberately not the full report — the centre is an
 * index, and loading every item and photo for every report would make a job
 * with several reports expensive to open.
 *
 * DRAFTs are included for admin, flagged by status: an admin needs to see that
 * a cleaner has a report in progress, which is exactly the state that would
 * otherwise be invisible until submit.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const reports = await db.damageReport.findMany({
      where: { jobId: params.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        clientVisible: true,
        submittedAt: true,
        reviewedAt: true,
        reportedBy: { select: { name: true, email: true } },
        items: { select: { severity: true } },
      },
    });

    return NextResponse.json({
      reports: reports.map((report) => ({
        id: report.id,
        status: report.status,
        clientVisible: report.clientVisible,
        submittedAt: report.submittedAt,
        reviewedAt: report.reviewedAt,
        reportedByName: report.reportedBy?.name?.trim() || report.reportedBy?.email || null,
        itemCount: report.items.length,
        highestSeverity: highestDamageSeverity(report.items.map((item) => item.severity)),
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Could not load damage reports." }, { status: 400 });
  }
}
