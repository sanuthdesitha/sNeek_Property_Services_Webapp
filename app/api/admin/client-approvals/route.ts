import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  createClientApproval,
  listClientApprovals,
  type ClientApprovalStatus,
} from "@/lib/commercial/client-approvals";

const createSchema = z.object({
  clientId: z.string().trim().min(1),
  propertyId: z.string().trim().min(1).optional().nullable(),
  jobId: z.string().trim().min(1).optional().nullable(),
  quoteId: z.string().trim().min(1).optional().nullable(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(6000).default(""),
  amount: z.number().min(0),
  currency: z.string().trim().min(1).max(8).optional(),
  expiresAt: z.string().datetime().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

function parseStatus(input: string | null): ClientApprovalStatus | undefined {
  if (
    input === "PENDING" ||
    input === "APPROVED" ||
    input === "DECLINED" ||
    input === "CANCELLED" ||
    input === "EXPIRED"
  ) {
    return input;
  }
  return undefined;
}

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get("clientId")?.trim() || undefined;
    const status = parseStatus(searchParams.get("status"));
    const rows = await listClientApprovals({ clientId, status });

    const clientIds = Array.from(new Set(rows.map((row) => row.clientId)));
    const propertyIds = Array.from(
      new Set(rows.map((row) => row.propertyId).filter((value): value is string => Boolean(value)))
    );
    const jobIds = Array.from(
      new Set(rows.map((row) => row.jobId).filter((value): value is string => Boolean(value)))
    );

    const [clients, properties, jobs] = await Promise.all([
      clientIds.length
        ? db.client.findMany({
            where: { id: { in: clientIds } },
            select: { id: true, name: true, email: true },
          })
        : Promise.resolve([]),
      propertyIds.length
        ? db.property.findMany({
            where: { id: { in: propertyIds } },
            select: { id: true, name: true, suburb: true },
          })
        : Promise.resolve([]),
      jobIds.length
        ? db.job.findMany({
            where: { id: { in: jobIds } },
            select: {
              id: true,
              jobType: true,
              scheduledDate: true,
              property: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    const clientById = new Map(clients.map((row) => [row.id, row]));
    const propertyById = new Map(properties.map((row) => [row.id, row]));
    const jobById = new Map(jobs.map((row) => [row.id, row]));

    return NextResponse.json(
      rows.map((row) => ({
        ...row,
        client: clientById.get(row.clientId) ?? null,
        property: row.propertyId ? propertyById.get(row.propertyId) ?? null : null,
        job: row.jobId ? jobById.get(row.jobId) ?? null : null,
      }))
    );
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Request failed." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createSchema.parse(await req.json().catch(() => ({})));

    const client = await db.client.findUnique({
      where: { id: body.clientId },
      select: { id: true, name: true },
    });
    if (!client) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    const recipients = await db.user.findMany({
      where: {
        role: Role.CLIENT,
        clientId: body.clientId,
        isActive: true,
      },
      select: { id: true, email: true },
      take: 200,
    });

    const recipientUserIds = recipients.map((row) => row.id);
    const recipientEmails = recipients
      .map((row) => row.email?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value));

    const created = await createClientApproval({
      clientId: body.clientId,
      propertyId: body.propertyId ?? null,
      jobId: body.jobId ?? null,
      quoteId: body.quoteId ?? null,
      title: body.title,
      description: body.description,
      amount: body.amount,
      currency: body.currency ?? "AUD",
      requestedByUserId: session.user.id,
      expiresAt: body.expiresAt ?? null,
      metadata: {
        ...(body.metadata ?? {}),
        recipientUserIds,
        recipientEmails,
        sourceClientId: body.clientId,
      },
    });

    if (recipients.length > 0) {
      await db.notification.createMany({
        data: recipients.map((recipient) => ({
          userId: recipient.id,
          channel: NotificationChannel.PUSH,
          subject: "Approval required",
          body: `${client.name}: ${created.title}`,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        })),
      });
    }

    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Create failed." }, { status });
  }
}
