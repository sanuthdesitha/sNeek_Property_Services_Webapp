import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { Role } from "@prisma/client";
import { authOptions } from "@/lib/auth/auth-options";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 5_000;

/**
 * Server-Sent Events stream of new cleaner location pings. Polls the DB every
 * 5s and emits any pings newer than the last seen timestamp. Intentionally
 * simple — no message bus required. The admin live-map page subscribes once
 * with EventSource and merges incoming pings into its in-memory marker map.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== Role.ADMIN && session?.user?.role !== Role.OPS_MANAGER) {
    return new Response("Forbidden", { status: 403 });
  }

  const encoder = new TextEncoder();
  let lastTs = new Date(Date.now() - 60_000);
  let cancelled = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          cancelled = true;
        }
      };

      send({ type: "hello", at: new Date().toISOString() });

      req.signal.addEventListener("abort", () => {
        cancelled = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      });

      while (!cancelled) {
        try {
          const pings = await db.cleanerLocationPing.findMany({
            where: { timestamp: { gt: lastTs } },
            orderBy: { timestamp: "asc" },
            include: { user: { select: { id: true, name: true } } },
          });
          if (pings.length > 0) {
            for (const p of pings) {
              send({ type: "ping", ping: p });
            }
            lastTs = pings[pings.length - 1].timestamp;
          } else {
            // Heartbeat keeps middleware proxies from closing the connection.
            send({ type: "heartbeat", at: new Date().toISOString() });
          }
        } catch {
          // Transient DB error — keep the connection alive and retry next tick.
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
