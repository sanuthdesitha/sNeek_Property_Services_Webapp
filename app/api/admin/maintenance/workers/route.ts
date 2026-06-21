import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createMaintenanceWorker, listMaintenanceWorkers } from "@/lib/maintenance/workers";

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const workers = await listMaintenanceWorkers();
    return NextResponse.json({ workers });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  trade: z.string().trim().max(80).nullable().optional(),
  company: z.string().trim().max(160).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createSchema.parse(await req.json());
    const worker = await createMaintenanceWorker({ ...body, createdById: session.user.id });
    return NextResponse.json({ ok: true, id: worker.id });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
