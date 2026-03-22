import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { getStoredJobReport } from "@/lib/reports/access";
import { getJobReportPdfBuffer } from "@/lib/reports/pdf";
import { getAppSettings } from "@/lib/settings";
import { generateJobReport } from "@/lib/reports/generator";

export async function GET(
  req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const { searchParams } = new URL(req.url);
    const format = searchParams.get("format");
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.CLIENT, Role.CLEANER]);
    const [report, settings] = await Promise.all([getStoredJobReport(params.jobId), getAppSettings()]);
    if (!report) {
      generateJobReport(params.jobId).catch(() => {});
      return NextResponse.json(
        { error: "Report is being generated. Try again shortly." },
        { status: 202 }
      );
    }

    // Client role: enforce property ownership
    if (session.user.role === Role.CLIENT) {
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

    if (session.user.role === Role.CLEANER) {
      const assignment = await db.jobAssignment.findUnique({
        where: {
          jobId_userId: {
            jobId: params.jobId,
            userId: session.user.id,
          },
        },
        select: { jobId: true },
      });
      if (!assignment || report.cleanerVisible !== true) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    if (session.user.role === Role.LAUNDRY && report.laundryVisible !== true) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (format !== "html") {
      if (!report.pdfUrl) {
        generateJobReport(params.jobId).catch(() => {});
        return NextResponse.json(
          { error: "PDF is being generated. Try again shortly." },
          { status: 202 }
        );
      }
      try {
        const pdf = await getJobReportPdfBuffer(report, params.jobId);
        if (!pdf) {
          generateJobReport(params.jobId).catch(() => {});
          return NextResponse.json(
            { error: "PDF is being generated. Try again shortly." },
            { status: 202 }
          );
        }
        return new NextResponse(new Uint8Array(pdf), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="job-report-${params.jobId}.pdf"`,
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
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

