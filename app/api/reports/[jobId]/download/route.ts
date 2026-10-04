import { resolveRouteRole } from "@/lib/auth/route-role";
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { getStoredJobReport } from "@/lib/reports/access";
import { getJobReportPdfBuffer } from "@/lib/reports/pdf";
import { getAppSettings } from "@/lib/settings";
export async function GET(
  req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const { searchParams } = new URL(req.url);
    const format = searchParams.get("format");
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.CLIENT, Role.CLEANER]);
    const role = resolveRouteRole(session.user, [Role.ADMIN, Role.OPS_MANAGER, Role.CLIENT, Role.CLEANER]);
    const [report, settings] = await Promise.all([getStoredJobReport(params.jobId), getAppSettings()]);
    if (!report) {
      return NextResponse.json(
        { error: "Report is not prepared. Ask an administrator to generate it using the report generation action.", code: "REPORT_GENERATION_REQUIRED" },
        { status: 409 }
      );
    }

    // Client role: enforce property ownership
    if (role === Role.CLIENT) {
      const user = await db.user.findUnique({
        where: { id: session.user.id },
        select: { clientId: true },
      });
      if (
        report.job.property.clientId !== user?.clientId ||
        settings.clientPortalVisibility.showReports !== true ||
        report.clientVisible !== true ||
        (format !== "html" && settings.clientPortalVisibility.showReportDownloads !== true)
      ) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    if (role === Role.CLEANER) {
      const assignment = await db.jobAssignment.findFirst({
        where: {
          jobId: params.jobId,
          userId: session.user.id,
          removedAt: null,
        },
        select: { jobId: true },
      });
      if (!assignment || report.cleanerVisible !== true) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    if (format !== "html") {
      try {
        // Prefer the published snapshot; any PDF fallback is rendered in memory.
        const pdf = await getJobReportPdfBuffer(report, params.jobId, { preferStored: true });
        if (!pdf) {
          return NextResponse.json(
            { error: "PDF report could not be generated for this job." },
            { status: 503 }
          );
        }
        return new NextResponse(new Uint8Array(pdf), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="job-report-${params.jobId}.pdf"`,
            "Cache-Control": "no-store, max-age=0",
            Pragma: "no-cache",
            Expires: "0",
          },
        });
      } catch (error: any) {
        return NextResponse.json(
          {
            error:
              error?.message ||
              "PDF generation failed. Ensure Playwright browsers are installed on the server.",
          },
          { status: 503 }
        );
      }
    }

    if (report.htmlContent) {
      return new NextResponse(report.htmlContent, {
        headers: { "Content-Type": "text/html" },
      });
    }
    return NextResponse.json({ error: "Report not yet available" }, { status: 404 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}

