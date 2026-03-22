import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { buildClientInvoiceXeroCsv, getClientInvoice } from "@/lib/billing/client-invoices";
import { db } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const invoice = await getClientInvoice(params.id);
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }
    const csv = await buildClientInvoiceXeroCsv(invoice);
    await db.clientInvoice.update({
      where: { id: invoice.id },
      data: { xeroExportedAt: new Date() },
    });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${invoice.invoiceNumber.toLowerCase()}-xero.csv"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not export invoice." }, { status: 400 });
  }
}
