import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getApiErrorStatus } from "@/lib/api/http";
import { isNotificationVisibleToRole, notificationWhereForRole, toNotificationFeedItem } from "@/lib/notifications/feed";

export async function GET() {
  try {
    const session = await requireSession();
    const role = session.user.role as Role;
    const where = notificationWhereForRole(role, session.user.id);
    const rows = await db.notification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
    });
    return NextResponse.json(
      rows
        .filter((row) => isNotificationVisibleToRole(row, role))
        .map((row) => toNotificationFeedItem(row, role))
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not load notifications." }, { status: getApiErrorStatus(err) });
  }
}

export async function DELETE() {
  try {
    const session = await requireSession();
    const role = session.user.role as Role;

    const result =
      role === Role.ADMIN || role === Role.OPS_MANAGER
        ? await db.notification.deleteMany({})
        : await db.notification.deleteMany({ where: { userId: session.user.id } });

    return NextResponse.json({ ok: true, deleted: result.count });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not clear notifications." }, { status: getApiErrorStatus(err) });
  }
}
