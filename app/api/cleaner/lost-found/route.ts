import { NextRequest, NextResponse } from "next/server";
import { Role, NotificationChannel, NotificationStatus, type LostFoundStatus } from "@prisma/client";
import { z, ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { isCleanerModuleEnabled } from "@/lib/portal-access";
import { resolveAppUrl } from "@/lib/app-url";
import { renderEmailTemplate } from "@/lib/email-templates";
import { logger } from "@/lib/logger";
import { hydrateItems } from "@/lib/lost-found/service";

const photoSchema = z.object({
  url: z.string().trim().min(1),
  key: z.string().trim().min(1),
  caption: z.string().trim().max(300).optional().nullable(),
});

const createSchema = z.object({
  jobId: z.string().trim().min(1),
  itemName: z.string().trim().min(1).max(180),
  location: z.string().trim().max(300).optional().nullable(),
  notes: z.string().trim().max(6000).optional().nullable(),
  photos: z.array(photoSchema).max(20).optional().default([]),
});

function errorStatus(err: any): number {
  if (err?.message === "UNAUTHORIZED") return 401;
  if (err?.message === "FORBIDDEN") return 403;
  return 400;
}

/** GET — the signed-in cleaner's own reported items (newest first). */
export async function GET() {
  try {
    const session = await requireRole([Role.CLEANER]);
    const settings = await getAppSettings();
    if (!isCleanerModuleEnabled(settings, "lostFound")) {
      return NextResponse.json({ error: "Lost & found is disabled for cleaners." }, { status: 403 });
    }
    const items = await db.lostFoundItem.findMany({
      where: { reportedByUserId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return NextResponse.json({ items: await hydrateItems(items) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: errorStatus(err) });
  }
}

/** POST — report a found item: creates the item + a REPORTED event, alerts admins. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const settings = await getAppSettings();
    if (!isCleanerModuleEnabled(settings, "lostFound")) {
      return NextResponse.json({ error: "Lost & found is disabled for cleaners." }, { status: 403 });
    }
    const body = createSchema.parse(await req.json());

    const assignment = await db.jobAssignment.findFirst({
      where: { jobId: body.jobId, userId: session.user.id },
      select: { jobId: true, removedAt: true },
    });
    if (!assignment || assignment.removedAt) {
      return NextResponse.json({ error: "You are not assigned to this job." }, { status: 403 });
    }

    const job = await db.job.findUnique({
      where: { id: body.jobId },
      select: { id: true, propertyId: true, property: { select: { name: true, suburb: true } } },
    });

    const item = await db.lostFoundItem.create({
      data: {
        jobId: body.jobId,
        propertyId: job?.propertyId ?? null,
        reportedByUserId: session.user.id,
        itemName: body.itemName,
        description: body.notes?.trim() || null,
        foundLocation: body.location?.trim() || null,
        photos: body.photos ?? [],
        status: "REPORTED" as LostFoundStatus,
        events: {
          create: {
            userId: session.user.id,
            action: "REPORTED",
            note: body.notes?.trim() || null,
            meta: { foundLocation: body.location?.trim() || null, photoCount: body.photos?.length ?? 0 },
          },
        },
      },
    });

    logger.info(
      { itemId: item.id, jobId: body.jobId, reportedBy: session.user.id },
      "lost-found item reported by cleaner"
    );

    // Best-effort admin alert (parity with the previous IssueTicket behaviour).
    const admins = await db.user.findMany({
      where: { role: Role.ADMIN, isActive: true },
      select: { id: true, email: true },
    });
    const link = resolveAppUrl("/v2/admin/lost-found", req);

    let notificationFailures = 0;
    for (const admin of admins) {
      if (!admin.email) continue;
      try {
        const emailTemplate = renderEmailTemplate(settings, "lostFoundAlert", {
          cleanerName: session.user.name ?? session.user.email,
          propertyName: `${job?.property?.name ?? "Unknown"}${job?.property?.suburb ? ` (${job.property.suburb})` : ""}`,
          itemName: body.itemName,
          location: body.location?.trim() || "—",
          notes: body.notes?.trim() || "—",
          caseLink: link,
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
            subject: "Lost & Found item reported",
            body: `Item: ${body.itemName}${body.location ? ` at ${body.location}` : ""} (${job?.property?.name ?? "Unknown property"})`,
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
      itemId: item.id,
      notificationWarning:
        notificationFailures > 0
          ? `${notificationFailures} admin notification(s) failed, but the item was recorded successfully.`
          : undefined,
    });
  } catch (err: any) {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return NextResponse.json({ error: first?.message ?? "Invalid request." }, { status: 400 });
    }
    return NextResponse.json({ error: err.message }, { status: errorStatus(err) });
  }
}
