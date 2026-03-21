import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { generateJobReport, REPORT_TEMPLATE_VERSION } from "@/lib/reports/generator";
import { getJobReportPdfBuffer } from "@/lib/reports/pdf";

export async function GET(
  req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const { searchParams } = new URL(req.url);
    const format = searchParams.get("format");
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.CLIENT, Role.CLEANER]);
    let report = await db.report.findUnique({
      where: { jobId: params.jobId },
      include: {
        job: { include: { property: true } },
      },
    });

    const [latestSubmission, latestQa] = await Promise.all([
      db.formSubmission.findFirst({
        where: { jobId: params.jobId },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      }),
      db.qAReview.findFirst({
        where: { jobId: params.jobId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);

    const hasCurrentTemplate = report?.htmlContent?.includes(
      `report-template:${REPORT_TEMPLATE_VERSION}`
    );

    const isStale =
      Boolean(report) &&
      (!hasCurrentTemplate ||
        (latestSubmission && latestSubmission.updatedAt > report!.updatedAt) ||
        (latestQa && latestQa.createdAt > report!.updatedAt));

    if (!report) {
      await generateJobReport(params.jobId);
      report = await db.report.findUnique({
        where: { jobId: params.jobId },
        include: {
          job: { include: { property: true } },
        },
      });
    } else if (isStale) {
      await generateJobReport(params.jobId);
      report = await db.report.findUnique({
        where: { jobId: params.jobId },
        include: {
          job: { include: { property: true } },
        },
      });
    }
    if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Client role: enforce property ownership
    if (session.user.role === Role.CLIENT) {
      const user = await db.user.findUnique({
        where: { id: session.user.id },
        select: { clientId: true },
      });
      if (report.job.property.clientId !== user?.clientId) {
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
      if (!assignment) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    if (format !== "html") {
      try {
        const pdf = await getJobReportPdfBuffer(report, params.jobId);
        if (!pdf) {
          throw new Error("Could not build PDF for this report.");
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

