import { NextRequest, NextResponse } from "next/server";
import { Role, TimeAdjustmentStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { listTimeAdjustmentRequests } from "@/lib/time/adjustment-requests";

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const statusRaw = searchParams.get("status");
    const status =
      statusRaw && Object.values(TimeAdjustmentStatus).includes(statusRaw as TimeAdjustmentStatus)
        ? (statusRaw as TimeAdjustmentStatus)
        : undefined;

    const rows = await listTimeAdjustmentRequests(status);
    return NextResponse.json(rows);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
