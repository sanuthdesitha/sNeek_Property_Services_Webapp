import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { updatePositionApplicationSchema } from "@/lib/workforce/service";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    const position = await updatePositionApplicationSchema(params.id, body.schema ?? body);
    return NextResponse.json({ ok: true, position });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not save form." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}
