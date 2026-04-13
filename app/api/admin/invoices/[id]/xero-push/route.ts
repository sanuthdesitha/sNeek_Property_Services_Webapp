import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { pushClientInvoiceToXero } from "@/lib/xero/client";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const invoice = await db.clientInvoice.findUnique({
      where: { id: params.id },
      include: { lines: true, client: true },
    });

    if (!invoice) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });

    const result = await pushClientInvoiceToXero({
      invoiceNumber: invoice.invoiceNumber,
      clientName: invoice.client.name || "Unknown Client",
      clientEmail: invoice.client.email || "no-reply@sneekops.com.au",
      clientXeroContactId: invoice.client.xeroContactId ?? undefined,
      lineItems: invoice.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitAmount: line.unitPrice,
        taxType: invoice.gstEnabled ? "OUTPUT" : "NONE",
      })),
      gstEnabled: invoice.gstEnabled,
    });

    // Update client with Xero contact ID if we created one
    if (!invoice.client.xeroContactId) {
      // Contact was auto-created; we'd need to fetch it back
      // For now, just log the success
    }

    return NextResponse.json({ ok: true, xeroInvoiceId: result.xeroInvoiceId });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not push invoice to Xero." }, { status });
  }
}
