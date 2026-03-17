import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { resolveAdminNotificationHref } from "@/lib/notifications/navigation";
import { getApiErrorStatus } from "@/lib/api/http";

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const logs = await db.notification.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      include: {
        user: { select: { name: true, email: true } },
      },
    });
    return NextResponse.json(
      logs.map((log) => ({
        ...log,
        href: resolveAdminNotificationHref(log),
      }))
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: getApiErrorStatus(err) });
  }
}

export async function DELETE() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const result = await db.notification.deleteMany({});
    return NextResponse.json({ ok: true, deleted: result.count });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: getApiErrorStatus(err) });
  }
}
