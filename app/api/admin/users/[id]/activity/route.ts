import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { systemActorOf } from "@/lib/audit/system-actor";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const [user, auditRows, notifications] = await Promise.all([
      db.user.findUnique({
        where: { id: params.id },
        select: { id: true, name: true, email: true },
      }),
      db.auditLog.findMany({
        where: {
          OR: [{ userId: params.id }, { entity: "User", entityId: params.id }],
        },
        orderBy: { createdAt: "desc" },
        take: 120,
      }),
      db.notification.findMany({
        where: { userId: params.id },
        orderBy: { createdAt: "desc" },
        take: 120,
      }),
    ]);
    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    // Rows a scheduled job stored under this account (AuditLog needs a user)
    // are the system's actions, not this person's: they are not listed here.
    const ownRows = auditRows.filter((row) => !(row.userId === params.id && row.entity !== "User" && systemActorOf(row.after)));
    const items = [
      ...ownRows.map((row) => {
        // VA portal actions carry the delegation in `after` (actorLabel,
        // onBehalfOfClientId — see auditClientPortalAction). Surfacing it makes
        // the row read "did X for client Y" instead of a bare entity id.
        const after = row.after as Record<string, unknown> | null;
        const actorLabel = typeof after?.actorLabel === "string" ? after.actorLabel : null;
        return {
          id: `audit-${row.id}`,
          type: "AUDIT",
          title: row.action,
          body: `${row.entity} · ${row.entityId}${actorLabel ? ` · ${actorLabel}` : ""}`,
          createdAt: row.createdAt,
        };
      }),
      ...notifications.map((row) => ({
        id: `notification-${row.id}`,
        type: "NOTIFICATION",
        title: row.subject || row.channel,
        body: row.body,
        createdAt: row.createdAt,
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({ user, items });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load activity." }, { status });
  }
}
