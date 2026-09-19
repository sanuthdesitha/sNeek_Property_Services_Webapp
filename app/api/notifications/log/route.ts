import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { cookies } from "next/headers";
import { effectivePortalVersion, parsePortalVersion, PORTAL_VERSION_COOKIE } from "@/lib/portal-version";
import { getDefaultPortalVersion } from "@/lib/portal-version-store";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getApiErrorStatus } from "@/lib/api/http";
import { isNotificationVisibleToRole, notificationWhereForRole, toNotificationFeedItem } from "@/lib/notifications/feed";
import { readInboxStates } from "@/lib/notifications/inbox-state-store";

const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function PATCH(request: Request) {
  try {
    const session = await requireSession();
    // Viewing another person's portal must not consume their unread work.
    if (session.impersonation) return NextResponse.json({ error: "Read status cannot be changed while impersonating." }, { status: 403, headers: privateHeaders });
    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 200
      || body.ids.some((id: unknown) => typeof id !== "string" || !id || id.length > 200)) {
      return NextResponse.json({ error: "Provide 1 to 200 notification IDs." }, { status: 400, headers: privateHeaders });
    }
    // PUSH records are the recipient's inbox copy. Never alter email provider receipts.
    const result = await db.notification.updateMany({
      where: { ...notificationWhereForRole(session.user.role as Role, session.user.id), id: { in: Array.from(new Set<string>(body.ids)) }, status: "SENT",
        OR: [{ deliveryStatus: null }, { deliveryStatus: "OPENED" }] },
      data: { deliveryStatus: "OPENED" },
    });
    return NextResponse.json({ ok: true, updated: result.count }, { headers: privateHeaders });
  } catch (err: unknown) {
    const status = getApiErrorStatus(err, 503);
    return NextResponse.json({ error: status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : "Could not mark notifications as read." }, { status, headers: privateHeaders });
  }
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const role = session.user.role as Role;
    const params = new URL(request.url).searchParams;
    const paginated = params.get("paginated") === "1";
    let before: { createdAt: Date; id: string } | null = null;
    if (paginated && params.has("cursor")) {
      try {
        const encoded = params.get("cursor")!;
        if (encoded.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error();
        const cursor = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
        if (cursor.userId !== session.user.id || typeof cursor.id !== "string" || !cursor.id || cursor.id.length > 200
          || typeof cursor.createdAt !== "string" || !Number.isFinite(Date.parse(cursor.createdAt))) throw new Error();
        before = { id: cursor.id, createdAt: new Date(cursor.createdAt) };
      } catch {
        return NextResponse.json({ error: "Invalid notification cursor." }, { status: 400, headers: privateHeaders });
      }
    }
    const version = effectivePortalVersion(await getDefaultPortalVersion(), parsePortalVersion(cookies().get(PORTAL_VERSION_COOKIE)?.value));
    const where = notificationWhereForRole(role, session.user.id);
    const rows = await db.notification.findMany({
      where: before ? { ...where, OR: [
        { createdAt: { lt: before.createdAt } },
        { createdAt: before.createdAt, id: { lt: before.id } },
      ] } : where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: paginated ? 201 : 200,
    });
    const page = rows.slice(0, 200);
    const last = page[page.length - 1];
    const nextCursor = paginated && rows.length > 200 && last
      ? Buffer.from(JSON.stringify({ userId: session.user.id, id: last.id, createdAt: last.createdAt.toISOString() })).toString("base64url")
      : null;
    const visibleItems = page.filter((row) => isNotificationVisibleToRole(row, role))
      .map((row) => toNotificationFeedItem(row, role, version));
    const states = params.get("lifecycle") === "1" ? await readInboxStates(session.user.id, visibleItems.map(row => row.id)) : null;
    const items = states ? visibleItems.map(row => ({ ...row, inboxState: states[row.id],
      lifecycle: { ...row.lifecycle, acknowledgement: states[row.id]?.acknowledgedAt ? "ACKNOWLEDGED" : "NOT_RECORDED" },
    })) : visibleItems;
    return NextResponse.json(
      paginated ? { items, nextCursor } : items,
      { headers: privateHeaders }
    );
  } catch (err: unknown) {
    const status = getApiErrorStatus(err, 503);
    const error = status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : "Could not load notifications.";
    return NextResponse.json({ error }, { status, headers: privateHeaders });
  }
}

export async function DELETE() {
  try {
    const session = await requireSession();
    if (session.impersonation) return NextResponse.json({ error: "Notifications cannot be cleared while impersonating." }, { status: 403, headers: privateHeaders });
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
