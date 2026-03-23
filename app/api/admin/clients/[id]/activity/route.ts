import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const client = await db.client.findUnique({
      where: { id: params.id },
      include: { users: { select: { id: true } } },
    });
    if (!client) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }
    const userIds = client.users.map((user) => user.id);
    const [auditRows, notifications] = await Promise.all([
      db.auditLog.findMany({
        where: {
          OR: [
            { entity: "Client", entityId: params.id },
            ...(userIds.length > 0 ? [{ entity: "User", entityId: { in: userIds } } as any] : []),
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 120,
      }),
      userIds.length > 0
        ? db.notification.findMany({
            where: { userId: { in: userIds } },
            orderBy: { createdAt: "desc" },
            take: 120,
          })
        : Promise.resolve([]),
    ]);

    const items = [
      ...auditRows.map((row) => ({
        id: `audit-${row.id}`,
        type: "AUDIT",
        title: row.action,
        body: `${row.entity} · ${row.entityId}`,
        createdAt: row.createdAt,
      })),
      ...notifications.map((row) => ({
        id: `notification-${row.id}`,
        type: "NOTIFICATION",
        title: row.subject || row.channel,
        body: row.body,
        createdAt: row.createdAt,
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({
      client: { id: client.id, name: client.name, email: client.email },
      items,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load activity." }, { status });
  }
}
