import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { runSlaEscalation } from "@/lib/ops/sla";

export async function POST() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const result = await runSlaEscalation(new Date());
    return NextResponse.json(result);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not run SLA escalation." }, { status });
  }
}

