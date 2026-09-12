import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { effectivePortalVersion, parsePortalVersion, PORTAL_VERSION_COOKIE } from "@/lib/portal-version";
import { getDefaultPortalVersion } from "@/lib/portal-version-store";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { isNotificationVisibleToRole, notificationWhereForRole, toNotificationFeedItem } from "@/lib/notifications/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Cursor = {
  createdAt: Date;
  id: string;
};

const REPLAY_WINDOW_MS = 10 * 60_000;

function eventId(userId: string, cursor: Cursor) {
  return Buffer.from(JSON.stringify([1, userId, cursor.createdAt.getTime(), cursor.id])).toString("base64url");
}

function replayCursor(raw: string | null, userId: string): Cursor | null {
  if (!raw || raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 4) return null;
    const [version, owner, timestamp, id] = value;
    const now = Date.now();
    if (version !== 1 || owner !== userId || typeof owner !== "string" || owner.length > 256 ||
        !Number.isSafeInteger(timestamp) || timestamp > now ||
        typeof id !== "string" || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id)) return null;
    const cursor = { createdAt: new Date(timestamp), id };
    if (eventId(userId, cursor) !== raw) return null;
    // Quiet streams retain old IDs; preserve recent gap events within the replay bound.
    return timestamp < now - REPLAY_WINDOW_MS
      ? { createdAt: new Date(now - REPLAY_WINDOW_MS), id: "" }
      : cursor;
  } catch {
    return null;
  }
}

function sseEvent(name: string, payload: unknown, id: string) {
  return `id: ${id}\nevent: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function keepAliveComment() {
  return `: keepalive ${Date.now()}\n\n`;
}

export async function GET(req: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const role = session.user.role as Role;
  const userId = session.user.id;
  const actorId = session.impersonation?.actorId;
  const impersonationMode = session.impersonation?.mode;
  const impersonationStartedAt = session.impersonation?.startedAt;
  // Cookies are a request snapshot; reconnect periodically to pick up browser changes.
  const sessionExpiry = Date.parse(session.expires);
  // NextAuth's getServerSession(options) strips expires in the App Router path.
  const deadline = Math.min(Date.now() + 60_000, Number.isFinite(sessionExpiry) ? sessionExpiry : Infinity);
  const version = effectivePortalVersion(await getDefaultPortalVersion(), parsePortalVersion(req.cookies.get(PORTAL_VERSION_COOKIE)?.value));
  const whereScope = notificationWhereForRole(role, session.user.id);
  const encoder = new TextEncoder();
  const cursor: Cursor = replayCursor(req.headers.get("last-event-id"), userId) ?? {
    createdAt: new Date(),
    id: "",
  };

  let closed = false;
  let polling = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  let lifetimeTimer: ReturnType<typeof setTimeout> | null = null;
  let cleanup = (_closeController = true) => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const onAbort = () => cleanup();
      cleanup = (closeController = true) => {
        if (closed) return;
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        if (lifetimeTimer) clearTimeout(lifetimeTimer);
        req.signal.removeEventListener("abort", onAbort);
        if (closeController) {
          try {
            controller.close();
          } catch {
            // Cancellation may have already closed the controller.
          }
        }
      };

      const enqueueSafe = (value: string) => {
        if (closed) return;
        if (req.signal.aborted || Date.now() >= deadline) {
          cleanup();
          return;
        }
        try {
          controller.enqueue(encoder.encode(value));
        } catch {
          cleanup();
        }
      };

      const revalidate = async () => {
        if (closed) return false;
        try {
          const current = await requireSession();
          if (closed) return false;
          if (req.signal.aborted || Date.now() >= deadline ||
              Date.parse(current.expires) <= Date.now() ||
              current.user.id !== userId || current.user.role !== role ||
              current.impersonation?.actorId !== actorId ||
              current.impersonation?.mode !== impersonationMode ||
              current.impersonation?.startedAt !== impersonationStartedAt) {
            cleanup();
            return false;
          }
          return true;
        } catch {
          cleanup();
          return false;
        }
      };

      const poll = async () => {
        if (closed || polling) return;
        polling = true;
        try {
          if (!(await revalidate())) return;
          const rows = await db.notification.findMany({
            where: {
              ...whereScope,
              OR: [
                { createdAt: { gt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id || "" } },
              ],
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: 100,
          });
          if (closed || rows.length === 0) return;
          // A query can outlive a revocation, so check again before releasing rows.
          if (!(await revalidate())) return;

          for (const row of rows) {
            if (closed) return;
            if (!isNotificationVisibleToRole(row, role)) {
              cursor.createdAt = row.createdAt;
              cursor.id = row.id;
              continue;
            }
            enqueueSafe(sseEvent("notification", toNotificationFeedItem(row, role, version), eventId(userId, row)));
            cursor.createdAt = row.createdAt;
            cursor.id = row.id;
          }
        } catch {
          // Keep the stream alive; the next poll can recover.
        } finally {
          polling = false;
        }
      };

      req.signal.addEventListener("abort", onAbort, { once: true });
      if (req.signal.aborted || Date.now() >= deadline) {
        cleanup();
        return;
      }
      enqueueSafe(sseEvent("ready", { connectedAt: new Date().toISOString() }, eventId(userId, cursor)));
      if (closed) return;
      lifetimeTimer = setTimeout(() => cleanup(), deadline - Date.now());
      pollTimer = setInterval(() => {
        void poll();
      }, 2500);
      keepAliveTimer = setInterval(() => {
        enqueueSafe(keepAliveComment());
      }, 15000);

    },
    cancel() {
      cleanup(false);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
