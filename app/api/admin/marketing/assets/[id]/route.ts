import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  await (db as any).marketingAsset.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
