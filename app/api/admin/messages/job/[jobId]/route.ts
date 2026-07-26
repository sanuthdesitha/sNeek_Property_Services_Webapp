import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";

/**
 * Admin side of the per-job client↔admin chat.
 *   GET  → { job, messages, relayedMessageIds } for this job's thread
 *   POST { body } → send as admin (isFromAdmin, jobId set); notifies client users
 * Client↔admin ONLY — cleaners never see this thread. Relaying a single message
 * to the assigned cleaner goes through ./relay.
 */

const schema = z.object({
  body: z.string().trim().min(1).max(4000),
});

export const dynamic = "force-dynamic";

async function loadJob(jobId: string) {
  return db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      jobNumber: true,
      property: { select: { name: true, clientId: true } },
    },
  });
}

export async function GET(_req: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const job = await loadJob(params.jobId);
    if (!job || !job.property?.clientId) {
      return NextResponse.json({ error: "Job has no client thread." }, { status: 404 });
    }

    const messages = await db.clientMessage.findMany({
      where: { clientId: job.property.clientId, jobId: job.id },
      include: {
        sentBy: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 500,
    });

    // Opening the thread marks the client's messages as read (same semantics
    // as the global admin thread, scoped to this job).
    await db.clientMessage.updateMany({
      where: { clientId: job.property.clientId, jobId: job.id, isFromAdmin: false, isRead: false },
      data: { isRead: true },
    });

    // "Relayed to cleaner" labels persist via the audit trail (no schema change).
    const relayLogs = await db.auditLog.findMany({
      where: { jobId: job.id, action: "CLIENT_MESSAGE_RELAYED", entity: "ClientMessage" },
      select: { entityId: true },
      take: 500,
    });

    return NextResponse.json({
      job: { id: job.id, jobNumber: job.jobNumber, propertyName: job.property.name },
      messages,
      relayedMessageIds: Array.from(new Set(relayLogs.map((log) => log.entityId))),
    });
  } catch (error: any) {
    const status =
      error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not load messages." }, { status });
  }
}

export async function POST(req: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const job = await loadJob(params.jobId);
    if (!job || !job.property?.clientId) {
      return NextResponse.json({ error: "Job has no client thread." }, { status: 404 });
    }

    const client = await db.client.findUnique({
      where: { id: job.property.clientId },
      select: {
        id: true,
        name: true,
        users: {
          where: { isActive: true },
          select: { id: true, role: true, email: true, phone: true, name: true },
        },
      },
    });
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

    const message = await db.clientMessage.create({
      data: {
        clientId: client.id,
        jobId: job.id,
        sentById: session.user.id,
        body: body.body,
        isFromAdmin: true,
      },
      include: {
        sentBy: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    if (client.users.length > 0) {
      await deliverNotificationToRecipients({
        recipients: client.users,
        category: "jobs",
        jobId: job.id,
        web: {
          subject: "New message about your clean",
          body: `The sNeek team replied on job ${job.jobNumber ? `#${job.jobNumber}` : ""} (${job.property.name}).`,
        },
        email: {
          subject: "New message from sNeek about your clean",
          html: `<p>You have a new message about job ${job.jobNumber ? `#${job.jobNumber}` : ""} at ${job.property.name}.</p><p>${body.body}</p>`,
        },
      });
    }

    return NextResponse.json(message, { status: 201 });
  } catch (error: any) {
    const status =
      error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not send message." }, { status });
  }
}
