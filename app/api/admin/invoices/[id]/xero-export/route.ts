import { NextRequest, NextResponse } from "next/server";
import { ClientInvoiceStatus, Role } from "@prisma/client";
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
    // A void invoice is cancelled. Exporting one hands the bookkeeping system a
    // CSV that reads exactly like a live receivable, and once it is imported the
    // only way back is a manual credit note in Xero — after which the accounts
    // and this system disagree about what the client owes, and Xero wins.
    if (invoice.status === ClientInvoiceStatus.VOID) {
      return NextResponse.json(
        { error: "This invoice is void. Export the replacement instead." },
        { status: 409 }
      );
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
