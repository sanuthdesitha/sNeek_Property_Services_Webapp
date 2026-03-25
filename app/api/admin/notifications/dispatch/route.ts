import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { sendAdminAttentionSummary } from "@/lib/ops/admin-attention-summary";
import { dispatchJobReminders } from "@/lib/ops/reminders";
import { sendStockAlerts } from "@/lib/ops/stock-alerts";
import { dispatchTomorrowPrepSummaries } from "@/lib/ops/tomorrow-prep";
import { db } from "@/lib/db";

const schema = z.object({
  dispatchType: z.enum(["REMINDER_24H", "REMINDER_2H", "TOMORROW_PREP", "STOCK_ALERTS", "ADMIN_ATTENTION"]),
  force: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json());

    let result: unknown;
    switch (body.dispatchType) {
      case "REMINDER_24H":
        result = await dispatchJobReminders({
          reminderType: "LONG",
          force: body.force ?? true,
          ignoreEnabled: true,
          useNextAvailableDate: true,
        });
        break;
      case "REMINDER_2H":
        result = await dispatchJobReminders({
          reminderType: "SHORT",
          force: body.force ?? true,
          ignoreEnabled: true,
          useNextAvailableDate: true,
        });
        break;
      case "TOMORROW_PREP":
        result = await dispatchTomorrowPrepSummaries(new Date(), {
          ignoreWindow: true,
          ignoreEnabled: true,
          useNextAvailableDate: false,
        });
        break;
      case "STOCK_ALERTS":
        result = await sendStockAlerts({
          ignoreWindow: true,
          ignoreEnabled: true,
        });
        break;
      case "ADMIN_ATTENTION":
        result = await sendAdminAttentionSummary({
          ignoreWindow: true,
          ignoreEnabled: true,
        });
        break;
      default:
        result = { skipped: ["Unsupported dispatch type."] };
    }

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "MANUAL_NOTIFICATION_DISPATCH",
        entity: "NotificationDispatch",
        entityId: body.dispatchType,
        after: {
          dispatchType: body.dispatchType,
          force: body.force ?? true,
          result,
        } as any,
        ipAddress:
          req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          req.headers.get("x-real-ip") ||
          null,
      },
    });

    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not dispatch notification." }, { status });
  }
}
