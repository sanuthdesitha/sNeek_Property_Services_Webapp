import { NextRequest, NextResponse } from "next/server";
import { Role, NotificationChannel, NotificationRecipientRole } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const preferences = await db.notificationPreference.findMany({
      orderBy: [{ eventKey: "asc" }, { recipientRole: "asc" }, { channel: "asc" }],
    });

    return NextResponse.json(preferences);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load preferences." }, { status });
  }
}

const bulkUpdateSchema = z.array(
  z.object({
    eventKey: z.string(),
    recipientRole: z.nativeEnum(NotificationRecipientRole),
    channel: z.nativeEnum(NotificationChannel),
    enabled: z.boolean(),
  })
);

export async function PATCH(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN]);
    const body = await req.json();
    const updates = bulkUpdateSchema.parse(body);

    await db.$transaction(
      updates.map((u) =>
        db.notificationPreference.upsert({
          where: {
            eventKey_recipientRole_channel: {
              eventKey: u.eventKey,
              recipientRole: u.recipientRole,
              channel: u.channel,
            },
          },
          create: {
            eventKey: u.eventKey,
            recipientRole: u.recipientRole,
            channel: u.channel,
            enabled: u.enabled,
          },
          update: { enabled: u.enabled },
        })
      )
    );

    return NextResponse.json({ ok: true, updated: updates.length });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update preferences." }, { status });
  }
}

const singleUpdateSchema = z.object({
  eventKey: z.string(),
  recipientRole: z.nativeEnum(NotificationRecipientRole),
  channel: z.nativeEnum(NotificationChannel),
  enabled: z.boolean(),
});

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN]);
    const body = singleUpdateSchema.parse(await req.json());

    const updated = await db.notificationPreference.upsert({
      where: {
        eventKey_recipientRole_channel: {
          eventKey: body.eventKey,
          recipientRole: body.recipientRole,
          channel: body.channel,
        },
      },
      create: {
        eventKey: body.eventKey,
        recipientRole: body.recipientRole,
        channel: body.channel,
        enabled: body.enabled,
      },
      update: { enabled: body.enabled },
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update preference." }, { status });
  }
}
