import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { generateJobReport } from "@/lib/reports/generator";
import { getAppSettings } from "@/lib/settings";

export async function POST(
  _req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const job = await db.job.findUnique({
      where: { id: params.jobId },
      select: {
        id: true,
        property: {
          select: {
            name: true,
            client: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    await generateJobReport(params.jobId);
    const settings = await getAppSettings();
    const requiresAdminInitiation = settings.strictClientAdminOnly;

    const report = await db.report.findUnique({
      where: { jobId: params.jobId },
      select: { pdfUrl: true, updatedAt: true, sentToClient: true, sentAt: true },
    });

    if (requiresAdminInitiation && report) {
      await db.notification.create({
        data: {
          channel: NotificationChannel.PUSH,
          subject: "Report generated (manual client share required)",
          body: `Report ${params.jobId} generated. Use Share action to send to client.`,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
      });
    }

    return NextResponse.json({
      ok: true,
      report,
      autoShare: {
        sent: false,
        recipients: [],
        error: requiresAdminInitiation
          ? "Auto-send disabled by admin communication policy."
          : undefined,
      },
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
