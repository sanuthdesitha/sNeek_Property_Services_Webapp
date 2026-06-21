import { NextRequest, NextResponse } from "next/server";
import { Role, MaintenancePingKind } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getWorkerForUser, recordMaintenancePing, userIsAssignedWorker } from "@/lib/maintenance/workers";

const schema = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number().nullable().optional(),
  kind: z.nativeEnum(MaintenancePingKind).optional(),
});

// A maintenance worker drops a GPS breadcrumb for their assigned visit.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.MAINTENANCE, Role.ADMIN, Role.OPS_MANAGER]);
    const isAdmin = session.user.role === Role.ADMIN || session.user.role === Role.OPS_MANAGER;
    if (!isAdmin && !(await userIsAssignedWorker(session.user.id, params.id))) {
      return NextResponse.json({ error: "Not your maintenance job." }, { status: 403 });
    }
    const body = schema.parse(await req.json());
    const worker = await getWorkerForUser(session.user.id);
    await recordMaintenancePing({
      itemId: params.id,
      workerId: worker?.id ?? null,
      lat: body.lat,
      lng: body.lng,
      accuracy: body.accuracy ?? null,
      kind: body.kind,
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
