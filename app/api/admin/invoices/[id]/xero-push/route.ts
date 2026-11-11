import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { pushClientInvoiceToXeroOnce } from "@/lib/billing/client-invoice-xero";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    // Shared with the bulk route: same lock, reservation and idempotency key.
    const result = await pushClientInvoiceToXeroOnce(params.id);
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not push invoice to Xero." }, { status });
  }
}
