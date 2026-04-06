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
      const detail = [
        job.jobNumber ? `${job.jobNumber}` : null,
        job.property.name,
        body.requestType === "LATE_CHECKOUT"
          ? `Late checkout until ${body.requestedTime || job.startTime || "time TBD"}`
          : `Early check-in due by ${body.requestedTime || job.dueTime || "time TBD"}`,
        body.note?.trim() || null,
      ]
        .filter(Boolean)
        .join(" | ");
      const reviewUrl = `${req.nextUrl.origin}/cleaner/jobs/${job.id}?timingRequest=${created.id}`;

      await deliverNotificationToRecipients({
        recipients: cleanerRecipients,
        category: "jobs",
        jobId: job.id,
        web: {
          subject: "Timing update approval requested",
          body: detail,
        },
        email: {
          subject: `Timing update approval requested - ${job.jobNumber || job.property.name}`,
          html: `
            <p>Hello,</p>
            <p>An admin timing update needs your approval for <strong>${job.property.name}</strong>.</p>
            <p><strong>Update type:</strong> ${body.requestType === "LATE_CHECKOUT" ? "Late checkout" : "Early check-in"}</p>
            ${body.requestedTime ? `<p><strong>Requested time:</strong> ${body.requestedTime}</p>` : ""}
            ${body.note?.trim() ? `<p><strong>Admin note:</strong> ${body.note.trim().replace(/</g, "&lt;")}</p>` : ""}
            <p><a href="${reviewUrl}">Review and respond</a></p>
          `,
          logBody: detail,
        },
        sms: `${detail} Review: ${reviewUrl}`,
      });
    }

    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not create request." }, { status });
  }
}
