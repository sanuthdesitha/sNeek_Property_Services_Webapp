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
  requestedStartTime: z.string().trim().regex(/^\d{2}:\d{2}$/).optional(),
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
        statusRaw === "PENDING" || statusRaw === "ACKNOWLEDGED" || statusRaw === "CANCELLED"
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
      requestedStartTime: body.requestedStartTime,
      note: body.note,
    });

    const cleanerRecipients = job.assignments
      .map((assignment) => assignment.user)
      .filter((user): user is NonNullable<typeof user> => Boolean(user && user.id && user.isActive));

    if (cleanerRecipients.length > 0) {
      const detail = [
        job.jobNumber ? `${job.jobNumber}` : null,
        job.property.name,
        body.requestedStartTime ? `Requested start ${body.requestedStartTime}` : null,
        body.note?.trim() || null,
      ]
        .filter(Boolean)
        .join(" | ");

      await deliverNotificationToRecipients({
        recipients: cleanerRecipients,
        category: "jobs",
        jobId: job.id,
        web: {
          subject: "Early checkout update requested",
          body: detail,
        },
        email: {
          subject: `Early checkout update requested - ${job.jobNumber || job.property.name}`,
          html: `
            <p>Hello,</p>
            <p>An early checkout update was requested for <strong>${job.property.name}</strong>.</p>
            ${body.requestedStartTime ? `<p><strong>Requested earlier start:</strong> ${body.requestedStartTime}</p>` : ""}
            ${body.note?.trim() ? `<p><strong>Admin note:</strong> ${body.note.trim().replace(/</g, "&lt;")}</p>` : ""}
          `,
          logBody: detail,
        },
        sms: detail,
      });
    }

    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not create request." }, { status });
  }
}
