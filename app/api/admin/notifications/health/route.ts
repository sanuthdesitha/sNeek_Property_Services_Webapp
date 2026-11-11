import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { readNotificationHealth } from "@/lib/notifications/health";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/** Transport health: credential presence (never values), switches, queues, worker. Same roles as dispatch-status. */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json(await readNotificationHealth(), { headers });
  } catch (error) {
    return NextResponse.json({ error: "Notification health is unavailable." }, { status: getApiErrorStatus(error, 503), headers });
  }
}
