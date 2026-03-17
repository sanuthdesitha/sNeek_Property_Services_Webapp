import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import {
  deletePayRun,
  getPayRunById,
  refreshPayRun,
  updatePayRunStatus,
  type PayRunStatus,
} from "@/lib/phase4/payruns";

const patchSchema = z.object({
  action: z.enum(["refresh"]).optional(),
  status: z.enum(["DRAFT", "LOCKED", "PAID"]).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const row = await getPayRunById(params.id);
    if (!row) return NextResponse.json({ error: "Pay run not found." }, { status: 404 });
    return NextResponse.json(row);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not fetch pay run." }, { status });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json().catch(() => ({})));
    if (body.action === "refresh") {
      const refreshed = await refreshPayRun(params.id, session.user.id);
      if (!refreshed) return NextResponse.json({ error: "Pay run not found." }, { status: 404 });
      return NextResponse.json(refreshed);
    }
    if (!body.status) {
      return NextResponse.json({ error: "Status or action is required." }, { status: 400 });
    }
    const updated = await updatePayRunStatus({
      id: params.id,
      status: body.status as PayRunStatus,
      notes: body.notes ?? undefined,
      userId: session.user.id,
    });
    if (!updated) return NextResponse.json({ error: "Pay run not found." }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update pay run." }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const ok = await deletePayRun(params.id);
    if (!ok) return NextResponse.json({ error: "Pay run not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not delete pay run." }, { status });
  }
}

