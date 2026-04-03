import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { listHiringApplications } from "@/lib/workforce/service";

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const applications = await listHiringApplications();
    return NextResponse.json(applications);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not load applications." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}
