import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  createEarlyCheckoutRequest,
  listEarlyCheckoutRequests,
} from "@/lib/jobs/early-checkout-requests";
import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";
import { loadNotificationWording } from "@/lib/notifications/wording/render";

const createSchema = z.object({
  jobId: z.string().trim().min(1),
  requestType: z.enum(["EARLY_CHECKIN", "LATE_CHECKOUT"]),
  requestedTime: z.string().trim().regex(/^\d{2}:\d{2}$/).optional(),
  note: z.string().trim().max(2000).optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("jobId")?.trim();
    const statusRaw = searchParams.get("status")?.trim();
    const rows = await listEarlyCheckoutRequests({
      jobId: jobId || undefined,
      status:
        statusRaw === "PENDING" || statusRaw === "APPROVED" || statusRaw === "DECLINED" || statusRaw === "CANCELLED"
          ? statusRaw
          : undefined,
    });
    return NextResponse.json(rows);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load requests." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createSchema.parse(await req.json().catch(() => ({})));

    const job = await db.job.findUnique({
      where: { id: body.jobId },
      select: {
      id: true,
      jobNumber: true,
      propertyId: true,
      startTime: true,
      dueTime: true,
      property: { select: { name: true } },
        assignments: {
          where: { removedAt: null },
          select: {
            user: { select: { id: true, name: true, email: true, phone: true, isActive: true, role: true } },
          },
        },
      },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    const created = await createEarlyCheckoutRequest({
      jobId: job.id,
      propertyId: job.propertyId,
      requestedById: session.user.id,
      requestType: body.requestType,
      requestedTime: body.requestedTime,
      note: body.note,
    });

    const cleanerRecipients = job.assignments
      .map((assignment) => assignment.user)
      .filter((user): user is NonNullable<typeof user> => Boolean(user && user.id && user.isActive));

    if (cleanerRecipients.length > 0) {
      const wording = await loadNotificationWording("office.cleaner_requests");
      const late = body.requestType === "LATE_CHECKOUT";
      const tbd = wording.line("time-tbd", "INBOX", {});
      const detail = [
        job.jobNumber ? `${job.jobNumber}` : null,
        job.property.name,
        late
          ? wording.line("late-checkout", "INBOX", { time: body.requestedTime || job.startTime || tbd })
          : wording.line("early-checkin", "INBOX", { time: body.requestedTime || job.dueTime || tbd }),
        body.note?.trim() || null,
      ]
        .filter(Boolean)
        .join(" | ");
      const reviewUrl = `${req.nextUrl.origin}/cleaner/jobs/${job.id}?timingRequest=${created.id}`;
      const adminNote = body.note?.trim();
      const timingInbox = wording.render("timing-request", "INBOX", { detail });
      const timingEmail = wording.render("timing-request", "EMAIL", {
        jobRef: job.jobNumber || job.property.name,
        propertyName: job.property.name,
        updateType: wording.line(late ? "type-late" : "type-early", "EMAIL", {}),
        requestedTimeParagraph: wording.line("requested-time", "EMAIL", { time: body.requestedTime }, Boolean(body.requestedTime)),
        adminNoteParagraph: wording.line("admin-note", "EMAIL", { note: adminNote }, Boolean(adminNote)),
        reviewUrl,
      });

      await deliverNotificationToRecipients({
        recipients: cleanerRecipients,
        category: "jobs",
        jobId: job.id,
        web: { subject: timingInbox.title, body: timingInbox.body },
        email: {
          subject: timingEmail.subject,
          html: timingEmail.html,
          logBody: detail,
        },
        sms: wording.render("timing-request", "SMS", { detail, reviewUrl }).body,
      });
    }

    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not create request." }, { status });
  }
}
