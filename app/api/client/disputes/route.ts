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
  status: z.enum(["OPEN", "UNDER_REVIEW", "RESOLVED", "REJECTED"]).optional(),
});

const createSchema = z.object({
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
    const session = await requireRole([Role.CLIENT]);
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { clientId: true },
    });
    if (!user?.clientId) {
      return NextResponse.json({ error: "Client profile missing." }, { status: 400 });
    }
    const { searchParams } = new URL(req.url);
    const query = querySchema.parse({
      status: searchParams.get("status") ?? undefined,
    });
    const rows = await listDisputes({
      clientId: user.clientId,
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
    const session = await requireRole([Role.CLIENT]);
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { clientId: true },
    });
    if (!user?.clientId) {
      return NextResponse.json({ error: "Client profile missing." }, { status: 400 });
    }
    const body = createSchema.parse(await req.json().catch(() => ({})));
    const created = await createDispute({
      clientId: user.clientId,
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
    const admins = await db.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
      select: { id: true },
      take: 50,
    });
    if (admins.length > 0) {
      await db.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id,
          jobId: created.jobId ?? undefined,
          channel: NotificationChannel.PUSH,
          subject: "Client dispute opened",
          body: `${body.title} (${created.currency} ${Number(created.amountDisputed ?? 0).toFixed(2)})`,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        })),
      });
    }
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not create dispute." }, { status });
  }
}
