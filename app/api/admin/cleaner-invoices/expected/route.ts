import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getExpectedInvoicesForPeriod } from "@/lib/cleaner/expected-invoice";

/**
 * Predicted cleaner invoices for a pay period — powers the admin transparency /
 * "money to prepare" view. Read-only; computes from live job data each call.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("start") || undefined;
    const endDate = searchParams.get("end") || undefined;
    const cleanerId = searchParams.get("cleanerId") || undefined;
    const result = await getExpectedInvoicesForPeriod({ startDate, endDate, cleanerId });
    return NextResponse.json(result);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not compute expected invoices." }, { status });
  }
}
