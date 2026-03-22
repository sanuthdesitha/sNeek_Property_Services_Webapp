import { NextRequest, NextResponse } from "next/server";
import { ClientInvoiceStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getClientInvoice } from "@/lib/billing/client-invoices";
import { db } from "@/lib/db";

const patchSchema = z.object({
  status: z.nativeEnum(ClientInvoiceStatus).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const invoice = await getClientInvoice(params.id);
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }
    return NextResponse.json(invoice);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not load invoice." }, { status: 400 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json().catch(() => ({})));
    return NextResponse.json(
      await db.clientInvoice.update({
        where: { id: params.id },
        data: { status: body.status },
      })
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not update invoice." }, { status: 400 });
  }
}
