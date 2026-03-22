import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { listInvoiceContext } from "@/lib/billing/client-invoices";

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json(await listInvoiceContext());
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not load invoices." }, { status: 400 });
  }
}
