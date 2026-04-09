import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { resolveAdminNotificationHref } from "@/lib/notifications/navigation";
import { getApiErrorStatus } from "@/lib/api/http";

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim().toLowerCase() ?? "";
    const channel = searchParams.get("channel")?.trim() ?? "all";
    const status = searchParams.get("status")?.trim() ?? "all";
    const source = searchParams.get("source")?.trim() ?? "all";
    const pageParam = Number(searchParams.get("page") ?? "1");
    const limitParam = Number(searchParams.get("limit") ?? "50");
    const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
    const limit = Number.isFinite(limitParam) ? Math.min(100, Math.max(20, Math.floor(limitParam))) : 50;
    const fetchTake = Math.min(500, Math.max(150, page * limit * 3));

    const [logs, audits] = await Promise.all([
      db.notification.findMany({
        orderBy: { createdAt: "desc" },
        take: fetchTake,
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
        take: Math.max(100, page * limit * 2),
        include: {
          user: { select: { name: true, email: true } },
        },
      }),
    ]);

    const merged = [...logs.map((log) => ({
        ...log,
        source: "notification",
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
        source: "audit",
        user: row.user,
        href: row.jobId ? `/admin/jobs/${row.jobId}` : "/admin/notifications",
      }))].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const filtered = merged.filter((item) => {
      if (source !== "all" && item.source !== source) return false;
      if (channel !== "all" && String(item.channel) !== channel) return false;
      if (status !== "all" && String(item.status) !== status) return false;
      if (!q) return true;
      const haystack = [
        item.subject,
        item.body,
        item.user?.name,
        item.user?.email,
        item.channel,
        item.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });

    const start = (page - 1) * limit;
    return NextResponse.json({
      items: filtered.slice(start, start + limit),
      pagination: {
        page,
        limit,
        totalCount: filtered.length,
        totalPages: Math.max(1, Math.ceil(filtered.length / limit)),
        hasMore: start + limit < filtered.length,
      },
    });
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
