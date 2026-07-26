import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";

/**
 * POST { messageId } — relay one client chat message to the job's assigned
 * cleaner(s) as an in-app + push notification. This is a one-way notification
 * (per policy there is NO client↔cleaner chat); the relay is audit-logged so
 * the admin thread can label the message as relayed.
 */

const schema = z.object({
  messageId: z.string().cuid(),
});

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));

    const job = await db.job.findUnique({
      where: { id: params.jobId },
      select: {
        id: true,
        jobNumber: true,
        property: { select: { name: true, clientId: true } },
        assignments: {
          where: { removedAt: null },
          select: {
            user: { select: { id: true, role: true, name: true, email: true, phone: true, isActive: true } },
          },
        },
      },
    });
    if (!job || !job.property?.clientId) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    const message = await db.clientMessage.findFirst({
      where: { id: body.messageId, jobId: job.id, clientId: job.property.clientId },
      select: { id: true, body: true, isFromAdmin: true },
    });
    if (!message) {
      return NextResponse.json({ error: "Message not found on this job." }, { status: 404 });
    }

    const cleaners = job.assignments
      .map((assignment) => assignment.user)
      .filter((user) => user && user.isActive && user.role === "CLEANER")
      .map((user) => ({
        id: user.id,
        role: user.role,
        name: user.name,
        email: user.email,
        phone: user.phone,
      }));
    if (cleaners.length === 0) {
      return NextResponse.json({ error: "No assigned cleaner to relay to." }, { status: 400 });
    }

    await deliverNotificationToRecipients({
      recipients: cleaners,
      category: "jobs",
      jobId: job.id,
      web: {
        subject: `Message from the client — job ${job.jobNumber ? `#${job.jobNumber}` : ""}`.trim(),
        body: `${job.property.name}: “${message.body.slice(0, 240)}${message.body.length > 240 ? "…" : ""}” (relayed by ${session.user.name ?? "admin"})`,
      },
      email: {
        subject: `Client message relayed — job ${job.jobNumber ? `#${job.jobNumber}` : ""}`.trim(),
        html: `
          <p>An admin relayed a client message for ${job.property.name}.</p>
          <blockquote>${message.body}</blockquote>
        `,
      },
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: job.id,
        action: "CLIENT_MESSAGE_RELAYED",
        entity: "ClientMessage",
        entityId: message.id,
        after: {
          relayedToUserIds: cleaners.map((cleaner) => cleaner.id),
          bodyPreview: message.body.slice(0, 200),
        },
      },
    });

    return NextResponse.json({ ok: true, relayedTo: cleaners.length });
  } catch (error: any) {
    const status =
      error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not relay message." }, { status });
  }
}
