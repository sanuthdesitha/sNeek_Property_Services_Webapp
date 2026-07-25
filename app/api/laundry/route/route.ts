/**
 * Laundry route builder API.
 *
 * GET  /api/laundry/route?date=YYYY-MM-DD
 *   → { route, candidates, tasks }
 *   route      = the caller's LaundryRoute for that Sydney day (ACTIVE preferred,
 *                then DRAFT, then most recent) or null. Stops are the persisted
 *                lean JSON shape ({taskId, kind, order, propertyId, arrivedAt?,
 *                completedAt?}).
 *   candidates = tasks the caller may route: due today, due tomorrow
 *                (pull-forward) and OVERDUE (scheduled before today, not
 *                DROPPED/SKIPPED, capped ~20) — see lib/laundry/route-candidates.
 *   tasks      = the full week-feed task rows referenced by candidates and the
 *                route's stops (for badges + the action modal).
 *
 * POST /api/laundry/route
 *   { date, stops: [{taskId, kind, order, propertyId}], activate? }
 *   Upserts the caller's route for that day (stops validated against the
 *   candidate set + visibility, order normalized 0..n; existing arrival/
 *   completion stamps are preserved). activate:true → status ACTIVE +
 *   startedAt, superseding any other ACTIVE route of the caller (ABANDONED).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getApiErrorStatus } from "@/lib/api/http";
import { laundryWeekTaskInclude, filterTasksVisibleToUser } from "@/lib/laundry/week-feed";
import { loadCandidatesAndTasks, sydneyDayKey } from "@/lib/laundry/route-candidates";
import {
  normalizeStops,
  parseRouteStops,
  type RouteStopJson,
} from "@/lib/laundry/route-plan";

export const dynamic = "force-dynamic";

function parseDateParam(raw: string | null): Date {
  if (raw) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const parsed = new Date(`${raw}T00:00:00Z`);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    } else {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) return sydneyDayKey(parsed);
    }
  }
  return sydneyDayKey(new Date());
}

function pickRoute<T extends { status: string; updatedAt: Date }>(routes: T[]): T | null {
  const rank = (s: string) =>
    s === "ACTIVE" ? 0 : s === "DRAFT" ? 1 : s === "COMPLETED" ? 2 : 3;
  return (
    [...routes].sort(
      (a, b) => rank(a.status) - rank(b.status) || b.updatedAt.getTime() - a.updatedAt.getTime(),
    )[0] ?? null
  );
}

function serializeRoute(route: {
  id: string;
  date: Date;
  status: string;
  startedAt: Date | null;
  endedAt: Date | null;
  stops: unknown;
}) {
  return {
    id: route.id,
    date: route.date.toISOString(),
    status: route.status,
    startedAt: route.startedAt?.toISOString() ?? null,
    endedAt: route.endedAt?.toISOString() ?? null,
    stops: parseRouteStops(route.stops),
  };
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
    const viewer = { role: session.user.role, userId: session.user.id };
    const { searchParams } = new URL(req.url);
    const dateKey = parseDateParam(searchParams.get("date"));
    const todayKey = sydneyDayKey(new Date());

    const [routes, { candidates, tasks }] = await Promise.all([
      db.laundryRoute.findMany({ where: { userId: session.user.id, date: dateKey } }),
      loadCandidatesAndTasks(todayKey, viewer),
    ]);
    const route = pickRoute(routes);

    // The route may reference tasks that fell out of the candidate window
    // (e.g. a completed drop) — hydrate those too so the runner can render them.
    let allTasks = tasks;
    if (route) {
      const have = new Set(tasks.map((t) => t.id));
      const missing = parseRouteStops(route.stops)
        .map((s) => s.taskId)
        .filter((id) => !have.has(id));
      if (missing.length > 0) {
        const extra = await db.laundryTask.findMany({
          where: { id: { in: Array.from(new Set(missing)) } },
          include: laundryWeekTaskInclude,
        });
        allTasks = [...tasks, ...filterTasksVisibleToUser(extra, viewer.role, viewer.userId)];
      }
    }

    return NextResponse.json({
      route: route ? serializeRoute(route) : null,
      candidates,
      tasks: allTasks,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: getApiErrorStatus(err) });
  }
}

const postSchema = z.object({
  date: z.string().min(1),
  stops: z
    .array(
      z.object({
        taskId: z.string().min(1),
        kind: z.enum(["PICKUP", "DROP"]),
        order: z.number().int().min(0),
        propertyId: z.string().min(1),
      }),
    )
    .max(200),
  activate: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
    const viewer = { role: session.user.role, userId: session.user.id };
    const body = postSchema.parse(await req.json());
    const dateKey = parseDateParam(body.date);
    const todayKey = sydneyDayKey(new Date());
    const now = new Date();

    // Validate every stop against the candidate set (and anything already in
    // the route — completing a stop must not invalidate a later save).
    const { candidates } = await loadCandidatesAndTasks(todayKey, viewer);
    const allowed = new Set(candidates.map((c) => `${c.taskId}:${c.kind}`));

    const existing = pickRoute(
      await db.laundryRoute.findMany({
        where: { userId: session.user.id, date: dateKey, status: { in: ["DRAFT", "ACTIVE"] } },
      }),
    );
    const existingStops = existing ? parseRouteStops(existing.stops) : [];
    for (const stop of existingStops) allowed.add(`${stop.taskId}:${stop.kind}`);

    const invalid = body.stops.filter((s) => !allowed.has(`${s.taskId}:${s.kind}`));
    if (invalid.length > 0) {
      return NextResponse.json(
        {
          error: "Some stops are not routeable (not visible to you or no longer due).",
          invalid: invalid.map((s) => ({ taskId: s.taskId, kind: s.kind })),
        },
        { status: 400 },
      );
    }

    // Preserve arrival/completion stamps for stops that survive the edit.
    const stampByKey = new Map(existingStops.map((s) => [`${s.taskId}:${s.kind}`, s]));
    const nextStops: RouteStopJson[] = normalizeStops(
      body.stops.map((s) => {
        const prev = stampByKey.get(`${s.taskId}:${s.kind}`);
        return {
          taskId: s.taskId,
          kind: s.kind,
          order: s.order,
          propertyId: s.propertyId,
          arrivedAt: prev?.arrivedAt ?? null,
          completedAt: prev?.completedAt ?? null,
        };
      }),
    );

    const activate = body.activate === true;
    const route = existing
      ? await db.laundryRoute.update({
          where: { id: existing.id },
          data: {
            stops: nextStops as unknown as object,
            ...(activate ? { status: "ACTIVE", startedAt: existing.startedAt ?? now } : {}),
          },
        })
      : await db.laundryRoute.create({
          data: {
            userId: session.user.id,
            date: dateKey,
            stops: nextStops as unknown as object,
            ...(activate ? { status: "ACTIVE", startedAt: now } : { status: "DRAFT" }),
          },
        });

    if (activate) {
      // One live route per driver: supersede any other ACTIVE route.
      await db.laundryRoute.updateMany({
        where: { userId: session.user.id, status: "ACTIVE", id: { not: route.id } },
        data: { status: "ABANDONED", endedAt: now },
      });
    }

    return NextResponse.json({ route: serializeRoute(route) });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: err.format() }, { status: 400 });
    }
    return NextResponse.json({ error: err.message }, { status: getApiErrorStatus(err) });
  }
}
