import { NextRequest, NextResponse } from "next/server";
import { QaReworkTransferStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { listQaReworkTransfers } from "@/lib/qa/rework-transfers";

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const statusRaw = searchParams.get("status");
    const status =
      statusRaw && Object.values(QaReworkTransferStatus).includes(statusRaw as QaReworkTransferStatus)
        ? (statusRaw as QaReworkTransferStatus)
        : undefined;
    const rows = await listQaReworkTransfers(status);
    return NextResponse.json(rows);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
