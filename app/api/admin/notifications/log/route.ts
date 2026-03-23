import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { resolveAdminNotificationHref } from "@/lib/notifications/navigation";
import { getApiErrorStatus } from "@/lib/api/http";

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const [logs, audits] = await Promise.all([
      db.notification.findMany({
        orderBy: { createdAt: "desc" },
        take: 500,
        include: {
          user: { select: { name: true, email: true } },
        },
      }),
      db.auditLog.findMany({
        where: {
          action: {
            in: [
              "RESET_USER_PASSWORD",
              "SEND_CLIENT_INVITE",
              "DELETE_JOB",
              "RESET_JOB",
              "DEACTIVATE_PROPERTY",
              "DEACTIVATE_CLIENT",
              "DELETE_USER_ACCOUNT",
              "DEACTIVATE_FORM_TEMPLATE",
              "DELETE_CASE",
              "DELETE_LAUNDRY_TASK",
            ],
          },
        },
        orderBy: { createdAt: "desc" },
        take: 150,
        include: {
          user: { select: { name: true, email: true } },
        },
      }),
    ]);
    return NextResponse.json(
      [...logs.map((log) => ({
        ...log,
        href: resolveAdminNotificationHref(log),
      })), ...audits.map((row) => ({
        id: `audit-${row.id}`,
        userId: row.userId,
        jobId: row.jobId,
        channel: "AUDIT",
        subject: row.action,
        body: `${row.entity} ${row.entityId}`,
        status: "SENT",
        sentAt: row.createdAt,
        errorMsg: null,
        createdAt: row.createdAt,
        user: row.user,
        href: row.jobId ? `/admin/jobs/${row.jobId}` : "/admin/notifications",
      }))].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
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
