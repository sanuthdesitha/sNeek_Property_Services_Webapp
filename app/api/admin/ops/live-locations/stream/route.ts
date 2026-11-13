import { getOpsAccess } from "@/lib/rbac/ops-access";
import { canUseOpsPath } from "@/lib/rbac/ops-catalog";
import { NextRequest } from "next/server";
import { liveErrorStatus, requireLiveViewer } from "@/lib/ops/live-viewer";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { liveAccessFor } from "@/lib/ops/live-access";
import { advanceStreamCursor, initialStreamCursor, streamCursorWhere } from "@/lib/ops/live-stream";

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

// Per-process counter, hung off globalThis so the diagnostics API
// (a separate route) can read it without importing this file (Next.js
// route modules can only export route handlers + a few config symbols).
const globalRef = globalThis as unknown as { __sneekSseLiveLocations?: { active: number } };
if (!globalRef.__sneekSseLiveLocations) globalRef.__sneekSseLiveLocations = { active: 0 };
const sseState = globalRef.__sneekSseLiveLocations;

/**
 * Server-Sent Events stream of newly STORED location pings.
 *
 * The cursor is the server's receive time plus the row id, not the fix's
 * measured time: the tracker flushes every 30 s, so a fix measured before the
 * last cursor routinely arrives after it and was never streamed. Laundry
 * driver pings are sent only to viewers with the Laundry pack.
 *
 * Safety:
 *  - Max 50 concurrent connections per process
 *  - Max 10 minute lifetime per connection (client auto-reconnects)
 *  - 60s heartbeat (was effectively 5s — every poll tick)
 *  - 15s DB poll interval (was 5s)
 *  - Single cleanup function called on abort OR lifetime timeout
 */
export async function GET(req: NextRequest) {
  let session: { user: { id: string } };
  try {
    const viewer = await requireLiveViewer();
    session = { user: { id: viewer.userId } };
  } catch (err) {
    const status = liveErrorStatus(err);
    return new Response(status === 401 ? "UNAUTHORIZED" : "FORBIDDEN", { status });
  }

  if (sseState.active >= MAX_CONNECTIONS) {
    return new Response("Too many concurrent connections", { status: 503 });
  }

  sseState.active++;
  const encoder = new TextEncoder();
  let cursor = initialStreamCursor(Date.now());

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
          // A long-lived stream must stop as soon as office access is revoked.
          const actor = await db.user.findUnique({
            where: { id: session.user.id }, select: { isActive: true, role: true },
          });
          if (!actor?.isActive || (actor.role !== Role.ADMIN && actor.role !== Role.OPS_MANAGER)) {
            cleanup();
            return;
          }
          const access = await getOpsAccess({ id: session.user.id, role: actor.role });
          if (access && !canUseOpsPath(access, "/api/admin/ops/live-locations/stream", "GET")) {
            cleanup();
            return;
          }
          const liveAccess = liveAccessFor(access);
          if (!liveAccess.live) {
            cleanup();
            return;
          }
          const pings = await db.cleanerLocationPing.findMany({
            where: {
              ...streamCursorWhere(cursor),
              ...(liveAccess.drivers ? {} : { source: { not: "LAUNDRY_ROUTE" as const } }),
            },
            orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
            select: {
              id: true, userId: true, jobId: true, lat: true, lng: true, accuracy: true, heading: true, speed: true,
              timestamp: true, receivedAt: true, source: true,
              user: { select: { id: true, name: true } },
            },
            take: 100,
          });
          if (pings.length > 0) {
            for (const p of pings) {
              send({ type: "ping", ping: { ...p, measuredAt: p.timestamp } });
            }
            cursor = advanceStreamCursor(cursor, pings);
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
