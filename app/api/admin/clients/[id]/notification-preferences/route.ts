import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const updateSchema = z.object({
  notificationsEnabled: z.boolean().optional(),
  notifyOnEnRoute: z.boolean().optional(),
  notifyOnJobStart: z.boolean().optional(),
  notifyOnJobComplete: z.boolean().optional(),
  preferredChannel: z.enum(["EMAIL", "SMS", "BOTH"]).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const client = await db.client.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

    const pref = await db.clientNotificationPreference.upsert({
      where: { clientId: params.id },
      create: { clientId: params.id },
      update: {},
    });

    return NextResponse.json(pref);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const body = updateSchema.parse(await req.json());

    const client = await db.client.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

    const pref = await db.clientNotificationPreference.upsert({
      where: { clientId: params.id },
      create: { clientId: params.id, ...body },
      update: body,
    });

    return NextResponse.json(pref);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}
