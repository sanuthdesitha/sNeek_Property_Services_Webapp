import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { isNotificationVisibleToRole, notificationWhereForRole, toNotificationFeedItem } from "@/lib/notifications/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Cursor = {
  createdAt: Date;
  id: string;
};

function sseEvent(name: string, payload: unknown) {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
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
  const whereScope = notificationWhereForRole(role, session.user.id);
  const encoder = new TextEncoder();
  const cursor: Cursor = {
    createdAt: new Date(),
    id: "",
  };

  let closed = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (keepAliveTimer) clearInterval(keepAliveTimer);
      };

      const enqueueSafe = (value: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(value));
        } catch {
          cleanup();
        }
      };

      const poll = async () => {
        if (closed) return;
        try {
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
          if (rows.length === 0) return;

          for (const row of rows) {
            if (!isNotificationVisibleToRole(row, role)) {
              cursor.createdAt = row.createdAt;
              cursor.id = row.id;
              continue;
            }
            enqueueSafe(sseEvent("notification", toNotificationFeedItem(row, role)));
            cursor.createdAt = row.createdAt;
            cursor.id = row.id;
          }
        } catch {
          // Keep the stream alive; the next poll can recover.
        }
      };

      enqueueSafe(sseEvent("ready", { connectedAt: new Date().toISOString() }));
      pollTimer = setInterval(() => {
        void poll();
      }, 2500);
      keepAliveTimer = setInterval(() => {
        enqueueSafe(keepAliveComment());
      }, 15000);

      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // Ignore close errors.
        }
      });
    },
    cancel() {
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      if (keepAliveTimer) clearInterval(keepAliveTimer);
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
