import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import {
  resolveNotificationRuleRecipients,
  type NotificationRuleEvent,
} from "@/lib/phase4/notification-rules";

const schema = z.object({
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
  payload: z.record(z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const result = await resolveNotificationRuleRecipients({
      event: body.event as NotificationRuleEvent,
      payload: body.payload ?? {},
    });
    return NextResponse.json(result);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not resolve rule recipients." }, { status });
  }
}

