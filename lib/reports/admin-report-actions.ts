/**
 * The admin actions on one generated client report (the Client report PDFs
 * manager): change visibility, regenerate with a theme, delete. The single-row
 * routes under /api/admin/reports/[jobId]/* and the bulk route share these, so
 * a bulk change does exactly what the row button does. Callers authorise.
 */
import { NotificationChannel, NotificationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { mobilePendingMarker } from "@/lib/notifications/mobile-outbox-marker";
import { generateJobReport } from "@/lib/reports/generator";
import { getAppSettings } from "@/lib/settings";
import { loadNotificationWording } from "@/lib/notifications/wording/render";

export type ReportVisibilityPatch = {
  clientVisible?: boolean;
  cleanerVisible?: boolean;
  laundryVisible?: boolean;
  visibilityNote?: string | null;
};

export class ReportActionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ReportActionError";
  }
}

export async function setReportVisibility(jobId: string, patch: ReportVisibilityPatch, actorId: string) {
  return db.report.update({
    where: { jobId },
    data: {
      clientVisible: patch.clientVisible,
      cleanerVisible: patch.cleanerVisible,
      laundryVisible: patch.laundryVisible,
      visibilityNote: patch.visibilityNote === null ? null : patch.visibilityNote || undefined,
      visibilityUpdatedAt: new Date(),
      visibilityUpdatedById: actorId,
    },
    include: {
      visibilityUpdatedBy: { select: { id: true, name: true, email: true } },
    },
  });
}

/**
 * Regenerate one job's report. Under the strict communication policy the
 * office is told a manual share is needed; nothing is sent to the client.
 */
export async function regenerateReport(jobId: string, themeId: string | null) {
  const job = await db.job.findUnique({
    where: { id: jobId },
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
  if (!job) throw new ReportActionError("Job not found", 404);

  await generateJobReport(jobId, themeId || undefined);
  const settings = await getAppSettings();
  const requiresAdminInitiation = settings.strictClientAdminOnly;

  const report = await db.report.findUnique({
    where: { jobId },
    select: { pdfUrl: true, updatedAt: true, sentToClient: true, sentAt: true },
  });

  if (requiresAdminInitiation && report) {
    const notice = (await loadNotificationWording("office.reports_generated")).render("generated", "INBOX", { jobId });
    await db.notification.create({
      data: {
        externalId: mobilePendingMarker("reports"),
        channel: NotificationChannel.PUSH,
        subject: notice.title,
        body: notice.body,
        status: NotificationStatus.SENT,
        sentAt: new Date(),
      },
    });
  }
  return { report, requiresAdminInitiation };
}

export async function deleteReport(jobId: string): Promise<void> {
  await db.report.delete({ where: { jobId } });
}
