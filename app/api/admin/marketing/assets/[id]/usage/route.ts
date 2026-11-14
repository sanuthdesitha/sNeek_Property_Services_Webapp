import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { findImageUsage } from "@/lib/marketing/image-usage";

/** Where a library image is used (board "Marketing", 2026-11-16). Read only. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const usage = await findImageUsage(params.id);
    return NextResponse.json(usage, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error: any) {
    const status = error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not check where the image is used." }, { status });
  }
}
