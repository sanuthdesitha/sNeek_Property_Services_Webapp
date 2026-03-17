import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import {
  deleteNotificationRule,
  patchNotificationRule,
  type NotificationRuleEvent,
} from "@/lib/phase4/notification-rules";

const schema = z.object({
  name: z.string().trim().max(140).optional(),
  event: z
    .enum([
      "JOB_ASSIGNED",
      "JOB_STATUS_CHANGED",
      "QA_FAILED",
      "APPROVAL_REQUESTED",
      "DISPUTE_OPENED",
      "STOCK_LOW",
      "LAUNDRY_READY",
      "PAY_ADJUSTMENT_REQUESTED",
    ])
    .optional(),
  isActive: z.boolean().optional(),
  channels: z.array(z.nativeEnum(NotificationChannel)).optional(),
  roles: z.array(z.nativeEnum(Role)).optional(),
  userIds: z.array(z.string().trim().min(1)).optional(),
  throttleMinutes: z.number().int().min(0).max(1440).optional(),
  conditions: z.record(z.unknown()).optional().nullable(),
  templateSubject: z.string().trim().max(250).optional().nullable(),
  templateBody: z.string().trim().max(4000).optional().nullable(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const updated = await patchNotificationRule(params.id, {
      ...body,
      event: body.event as NotificationRuleEvent | undefined,
    });
    if (!updated) return NextResponse.json({ error: "Rule not found." }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update notification rule." }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const ok = await deleteNotificationRule(params.id);
    if (!ok) return NextResponse.json({ error: "Rule not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not delete notification rule." }, { status });
  }
}

