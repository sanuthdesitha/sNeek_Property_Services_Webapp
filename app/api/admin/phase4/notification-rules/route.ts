import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import {
  createNotificationRule,
  listNotificationRules,
  type NotificationRuleEvent,
} from "@/lib/phase4/notification-rules";

const createSchema = z.object({
  name: z.string().trim().min(1).max(140),
  event: z.enum([
    "JOB_ASSIGNED",
    "JOB_STATUS_CHANGED",
    "QA_FAILED",
    "APPROVAL_REQUESTED",
    "DISPUTE_OPENED",
    "STOCK_LOW",
    "LAUNDRY_READY",
    "PAY_ADJUSTMENT_REQUESTED",
  ]),
  channels: z.array(z.nativeEnum(NotificationChannel)).optional(),
  roles: z.array(z.nativeEnum(Role)).optional(),
  userIds: z.array(z.string().trim().min(1)).optional(),
  throttleMinutes: z.number().int().min(0).max(1440).optional(),
  conditions: z.record(z.unknown()).optional().nullable(),
  templateSubject: z.string().trim().max(250).optional().nullable(),
  templateBody: z.string().trim().max(4000).optional().nullable(),
});

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const rules = await listNotificationRules();
    return NextResponse.json(rules);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load notification rules." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createSchema.parse(await req.json().catch(() => ({})));
    const created = await createNotificationRule({
      ...body,
      event: body.event as NotificationRuleEvent,
      createdByUserId: session.user.id,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not create notification rule." }, { status });
  }
}

