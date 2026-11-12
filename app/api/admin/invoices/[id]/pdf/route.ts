import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getClientInvoice, renderClientInvoicePdf } from "@/lib/billing/client-invoices";
import { getAppSettings } from "@/lib/settings";
import { isProvisionalDueStatus } from "@/lib/billing/client-invoice-pdf-parts";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const [invoice, settings] = await Promise.all([getClientInvoice(params.id), getAppSettings()]);
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }
    // ?inline=1 renders in-browser (for the send-preview) instead of downloading.
    const inline = new URL(req.url).searchParams.get("inline");
    // An unsent invoice's due day is provisional: its terms are fixed when first sent.
    const pdf = await renderClientInvoicePdf(invoice, settings.companyName || "sNeek Property Services", settings.logoUrl || settings.reportLogoUrl, settings.invoicing, {
      provisionalDue: isProvisionalDueStatus(invoice.status),
    });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${invoice.invoiceNumber.toLowerCase()}.pdf"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not generate invoice PDF." }, { status: 400 });
  }
}
