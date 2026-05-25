import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { Role } from "@prisma/client";
import { authOptions } from "@/lib/auth/auth-options";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CPU safety limits — see docs/ops/vps-triage.md for context.
// Each SSE connection holds two intervals (heartbeat + poll) + a DB query
// every POLL_INTERVAL_MS. Without lifetime / connection caps, zombie clients
// (network drops without clean close) accumulate forever and pin CPU.
const HEARTBEAT_INTERVAL_MS = 60_000;       // was 5s implicit, now explicit 60s
const POLL_INTERVAL_MS = 15_000;            // was 5s — 3x less DB load
const MAX_LIFETIME_MS = 10 * 60_000;        // force-close after 10 min; client auto-reconnects
const MAX_CONNECTIONS = 50;                 // refuse beyond this per process

// Per-process counter. Exported so the diagnostics page can read it.
const globalRef = globalThis as unknown as { __sneekSseLiveLocations?: { active: number } };
if (!globalRef.__sneekSseLiveLocations) globalRef.__sneekSseLiveLocations = { active: 0 };
const sseState = globalRef.__sneekSseLiveLocations;

export function getActiveLiveLocationsConnections(): number {
  return sseState.active;
}

/**
 * Server-Sent Events stream of new cleaner location pings.
 *
 * Safety:
 *  - Max 50 concurrent connections per process
 *  - Max 10 minute lifetime per connection (client auto-reconnects)
 *  - 60s heartbeat (was effectively 5s — every poll tick)
 *  - 15s DB poll interval (was 5s)
 *  - Single cleanup function called on abort OR lifetime timeout
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== Role.ADMIN && session?.user?.role !== Role.OPS_MANAGER) {
    return new Response("Forbidden", { status: 403 });
  }

  if (sseState.active >= MAX_CONNECTIONS) {
    return new Response("Too many concurrent connections", { status: 503 });
  }

  sseState.active++;
  const encoder = new TextEncoder();
  let lastTs = new Date(Date.now() - 60_000);

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let lifetimeTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (pollTimer) clearInterval(pollTimer);
        if (lifetimeTimer) clearTimeout(lifetimeTimer);
        sseState.active = Math.max(0, sseState.active - 1);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const send = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };

      // Wire up cleanup triggers.
      req.signal.addEventListener("abort", cleanup);
      lifetimeTimer = setTimeout(cleanup, MAX_LIFETIME_MS);

      // Initial hello.
      send({ type: "hello", at: new Date().toISOString() });

      heartbeatTimer = setInterval(() => {
        send({ type: "heartbeat", at: new Date().toISOString() });
      }, HEARTBEAT_INTERVAL_MS);

      pollTimer = setInterval(async () => {
        if (closed) return;
        try {
          const pings = await db.cleanerLocationPing.findMany({
            where: { timestamp: { gt: lastTs } },
            orderBy: { timestamp: "asc" },
            include: { user: { select: { id: true, name: true } } },
            take: 100,
          });
          if (pings.length > 0) {
            for (const p of pings) {
              send({ type: "ping", ping: p });
            }
            lastTs = pings[pings.length - 1].timestamp;
          }
        } catch (err) {
          // Transient DB error — log + keep the connection alive.
          // eslint-disable-next-line no-console
          console.error("[live-locations/stream] poll error", err);
        }
      }, POLL_INTERVAL_MS);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
