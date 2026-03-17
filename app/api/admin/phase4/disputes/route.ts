import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  createDispute,
  enrichDisputes,
  listDisputes,
  type DisputePriority,
  type DisputeStatus,
} from "@/lib/phase4/disputes";

const querySchema = z.object({
  clientId: z.string().trim().optional(),
  status: z.enum(["OPEN", "UNDER_REVIEW", "RESOLVED", "REJECTED"]).optional(),
});

const createSchema = z.object({
  clientId: z.string().trim().optional().nullable(),
  propertyId: z.string().trim().optional().nullable(),
  jobId: z.string().trim().optional().nullable(),
  reportId: z.string().trim().optional().nullable(),
  invoiceRef: z.string().trim().max(120).optional().nullable(),
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(6000),
  amountDisputed: z.number().min(0).optional().nullable(),
  currency: z.string().trim().max(8).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const query = querySchema.parse({
      clientId: searchParams.get("clientId") ?? undefined,
      status: searchParams.get("status") ?? undefined,
    });
    const rows = await listDisputes({
      clientId: query.clientId ?? null,
      status: (query.status as DisputeStatus | undefined) ?? null,
    });
    const enriched = await enrichDisputes(rows);
    return NextResponse.json(enriched);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not list disputes." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createSchema.parse(await req.json().catch(() => ({})));
    const created = await createDispute({
      clientId: body.clientId ?? null,
      propertyId: body.propertyId ?? null,
      jobId: body.jobId ?? null,
      reportId: body.reportId ?? null,
      invoiceRef: body.invoiceRef ?? null,
      title: body.title,
      description: body.description,
      amountDisputed: body.amountDisputed ?? null,
      currency: body.currency ?? "AUD",
      priority: (body.priority as DisputePriority | undefined) ?? "MEDIUM",
      raisedByUserId: session.user.id,
    });

    if (created.clientId) {
      const recipients = await db.user.findMany({
        where: { role: Role.CLIENT, clientId: created.clientId, isActive: true },
        select: { id: true },
      });
      if (recipients.length > 0) {
        await db.notification.createMany({
          data: recipients.map((recipient) => ({
            userId: recipient.id,
            channel: NotificationChannel.PUSH,
            subject: "New dispute opened",
            body: created.title,
            status: NotificationStatus.SENT,
            sentAt: new Date(),
          })),
        });
      }
    }

    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not create dispute." }, { status });
  }
}

