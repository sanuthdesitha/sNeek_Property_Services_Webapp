import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { NotificationChannel, NotificationStatus } from "@prisma/client";
import { ZodError } from "zod";
import { isCleanerModuleEnabled } from "@/lib/portal-access";
import { resolveAppUrl } from "@/lib/app-url";
import { renderEmailTemplate } from "@/lib/email-templates";
import { composeCaseDescription } from "@/lib/issues/case-utils";

const schema = z.object({
  jobId: z.string().trim().min(1),
  itemName: z.string().trim().min(1),
  location: z.string().trim().min(1),
  notes: z.string().trim().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const settings = await getAppSettings();
    if (!isCleanerModuleEnabled(settings, "lostFound")) {
      return NextResponse.json({ error: "Lost & found is disabled for cleaners." }, { status: 403 });
    }
    const body = schema.parse(await req.json());

    const assignment = await db.jobAssignment.findFirst({
      where: { jobId: body.jobId, userId: session.user.id },
      select: { jobId: true, removedAt: true },
    });
    if (!assignment || assignment.removedAt) {
      return NextResponse.json({ error: "You are not assigned to this job." }, { status: 403 });
    }

    const description = composeCaseDescription({
      text: `Location: ${body.location}\n\n${body.notes}`,
      metadata: { tags: ["lost-found"] },
    });

    const ticket = await db.issueTicket.create({
      data: {
        jobId: body.jobId,
        title: `Lost & Found: ${body.itemName}`,
        description,
        severity: "MEDIUM",
        status: "OPEN",
      },
    });

    const [admins, job] = await Promise.all([
      db.user.findMany({
        where: { role: Role.ADMIN, isActive: true },
        select: { id: true, email: true, name: true },
      }),
      db.job.findUnique({
        where: { id: body.jobId },
        select: {
          id: true,
          property: { select: { name: true, suburb: true } },
        },
      }),
    ]);
    const caseLink = resolveAppUrl("/admin/issues", req);

    let notificationFailures = 0;
    for (const admin of admins) {
      if (!admin.email) continue;
      try {
        const emailTemplate = renderEmailTemplate(settings, "lostFoundAlert", {
          cleanerName: session.user.name ?? session.user.email,
          propertyName: `${job?.property?.name ?? "Unknown"}${job?.property?.suburb ? ` (${job.property.suburb})` : ""}`,
          itemName: body.itemName,
          location: body.location,
          notes: body.notes,
          caseLink,
        });
        const emailResult = await sendEmailDetailed({
          to: admin.email,
          subject: emailTemplate.subject,
          html: emailTemplate.html,
        });

        await db.notification.create({
          data: {
            userId: admin.id,
            jobId: body.jobId,
            channel: NotificationChannel.EMAIL,
            subject: "Lost & Found case opened",
            body: `Item: ${body.itemName} at ${body.location} (${job?.property?.name ?? "Unknown property"})`,
            status: emailResult.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
            sentAt: emailResult.ok ? new Date() : undefined,
            errorMsg: emailResult.ok ? undefined : emailResult.error,
          },
        });
        if (!emailResult.ok) notificationFailures += 1;
      } catch {
        notificationFailures += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      ticketId: ticket.id,
      notificationWarning:
        notificationFailures > 0
          ? `${notificationFailures} admin notification(s) failed, but the case was created successfully.`
          : undefined,
    });
  } catch (err: any) {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return NextResponse.json(
        { error: first?.message ?? "Invalid request." },
        { status: 400 }
      );
    }
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
