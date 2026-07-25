/**
 * PATCH /api/laundry/route/[id] — mutate one laundry route.
 *   { action: "reorder", stops: [{taskId, kind, order}] }  — same stop set, new order
 *   { action: "complete-stop", taskId, kind }              — stamp completedAt
 *   { action: "end" }                                      — status COMPLETED + endedAt
 * Auth: the route's owner, or ADMIN / OPS_MANAGER.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getApiErrorStatus } from "@/lib/api/http";
import {
  normalizeStops,
  parseRouteStops,
  type RouteStopJson,
} from "@/lib/laundry/route-plan";

export const dynamic = "force-dynamic";

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reorder"),
    stops: z
      .array(
        z.object({
          taskId: z.string().min(1),
          kind: z.enum(["PICKUP", "DROP"]),
          order: z.number().int().min(0),
        }),
      )
      .max(200),
  }),
  z.object({
    action: z.literal("complete-stop"),
    taskId: z.string().min(1),
    kind: z.enum(["PICKUP", "DROP"]),
  }),
  z.object({ action: z.literal("end") }),
]);

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

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json());

    const route = await db.laundryRoute.findUnique({ where: { id: params.id } });
    if (!route) {
      return NextResponse.json({ error: "Route not found" }, { status: 404 });
    }
    const isOwner = route.userId === session.user.id;
    const isManager = session.user.role === Role.ADMIN || session.user.role === Role.OPS_MANAGER;
    if (!isOwner && !isManager) {
      return NextResponse.json({ error: "Not your route" }, { status: 403 });
    }

    const stops = parseRouteStops(route.stops);
    const now = new Date();

    if (body.action === "end") {
      const updated = await db.laundryRoute.update({
        where: { id: route.id },
        data: { status: "COMPLETED", endedAt: now },
      });
      return NextResponse.json({ route: serializeRoute(updated) });
    }

    if (body.action === "complete-stop") {
      const idx = stops.findIndex((s) => s.taskId === body.taskId && s.kind === body.kind);
      if (idx === -1) {
        return NextResponse.json({ error: "Stop not on this route" }, { status: 404 });
      }
      const nextStops = stops.map((s, i) =>
        i === idx ? { ...s, completedAt: s.completedAt ?? now.toISOString() } : s,
      );
      const updated = await db.laundryRoute.update({
        where: { id: route.id },
        data: { stops: nextStops as unknown as object },
      });
      return NextResponse.json({ route: serializeRoute(updated) });
    }

    // reorder — must be the exact same (taskId, kind) set, just re-ordered.
    const key = (s: { taskId: string; kind: string }) => `${s.taskId}:${s.kind}`;
    const currentKeys = new Set(stops.map(key));
    const nextKeys = new Set(body.stops.map(key));
    if (
      currentKeys.size !== nextKeys.size ||
      Array.from(currentKeys).some((k) => !nextKeys.has(k))
    ) {
      return NextResponse.json(
        { error: "Reorder must contain exactly the route's current stops." },
        { status: 400 },
      );
    }
    const byKey = new Map(stops.map((s) => [key(s), s]));
    const reordered: RouteStopJson[] = normalizeStops(
      body.stops.map((s) => ({ ...(byKey.get(key(s)) as RouteStopJson), order: s.order })),
    );
    const updated = await db.laundryRoute.update({
      where: { id: route.id },
      data: { stops: reordered as unknown as object },
    });
    return NextResponse.json({ route: serializeRoute(updated) });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: err.format() }, { status: 400 });
    }
    return NextResponse.json({ error: err.message }, { status: getApiErrorStatus(err) });
  }
}
