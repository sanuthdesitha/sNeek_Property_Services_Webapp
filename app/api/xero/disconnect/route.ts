import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { disconnectXero } from "@/lib/xero/client";

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN]);
    await disconnectXero();
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not disconnect Xero." }, { status });
  }
}
