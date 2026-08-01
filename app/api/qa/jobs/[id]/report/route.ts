import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { buildQaReportHtml } from "@/lib/reports/qa-report";
import { renderPdfFromHtml } from "@/lib/reports/pdf";

// INTERNAL QA report — embeds ops-only data (cleaner pay clawbacks, damage cost
// estimates, inspector notes/names). Clients must NOT see it; they view their
// own report via /api/reports/[jobId]/download, which is gated on clientVisible.
const QA_ROLES = [Role.QA_INSPECTOR, Role.OPS_MANAGER, Role.ADMIN, Role.CLEANER] as const;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { searchParams } = new URL(req.url);
    const wantHtml = searchParams.get("format") === "html";
    const session = await requireRole([...QA_ROLES]);

    // Access control. QA/ops/admin always allowed. The assigned cleaner may view
    // their own job's QA report (their rework feedback).
    const role = session.user.role as Role;
    // The MODE IS DERIVED FROM THE SESSION, never from a query param — a caller
    // must not be able to ask for the internal variant, which carries pay
    // clawbacks, damage cost estimates and the inspector's private notes.
    const mode = role === Role.CLEANER ? "cleanerSafe" : "internal";
    if (role === Role.CLEANER) {
      const assignment = await db.jobAssignment.findFirst({
        where: { jobId: params.id, userId: session.user.id, removedAt: null },
        select: { id: true },
      });
      if (!assignment) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      // Per-inspection admin switch, mirroring Report.cleanerVisible for the job
      // report. No review yet → nothing to withhold.
      const review = await db.qAReview.findFirst({
        where: { jobId: params.id, kind: { in: ["QA", "ADMIN"] } },
        orderBy: { createdAt: "desc" },
        select: { cleanerReportVisible: true },
      });
      if (review && !review.cleanerReportVisible) {
        return NextResponse.json(
          { error: "This QA report has not been shared with you." },
          { status: 403 }
        );
      }
    }

    const built = await buildQaReportHtml(params.id, { mode });
    if (!built) {
      return NextResponse.json({ error: "QA report not available for this job." }, { status: 404 });
    }

    if (wantHtml) {
      return new NextResponse(built.html, { headers: { "Content-Type": "text/html" } });
    }

    const safeNumber = built.jobNumber.replace(/[^a-zA-Z0-9_-]/g, "");
    const pdf = await renderPdfFromHtml(built.html, "QA report PDF generation");
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="qa-report-${safeNumber}.pdf"`,
        "Cache-Control": "no-store, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "QA report generation failed." }, { status });
  }
}
