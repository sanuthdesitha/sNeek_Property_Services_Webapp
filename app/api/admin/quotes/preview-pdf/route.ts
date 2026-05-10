import { NextRequest, NextResponse } from "next/server";
import { QuoteStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { createQuoteSchema } from "@/lib/validations/quote";
import { buildQuoteHtml } from "@/lib/pricing/quote-report";
import { getAppSettings } from "@/lib/settings";

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createQuoteSchema.parse(await req.json());
    const settings = await getAppSettings();

    const previewQuote = {
      id: "PREVIEW",
      serviceType: body.serviceType,
      status: QuoteStatus.DRAFT,
      createdAt: new Date(),
      validUntil: body.validUntil ? new Date(body.validUntil) : null,
      lineItems: body.lineItems,
      subtotal: body.subtotal,
      gstAmount: body.gstAmount,
      totalAmount: body.totalAmount,
      notes: body.notes ?? null,
      client: null,
      lead: null,
    };

    const html = buildQuoteHtml(previewQuote, {
      companyName: settings.companyName,
      logoUrl: settings.logoUrl,
    });
    try {
      const { renderPdfFromHtml } = await import("@/lib/reports/pdf");
      const pdf = await renderPdfFromHtml(html, "quote preview PDF generation");

      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="quote-preview.pdf"',
        },
      });
    } catch {
      return new NextResponse(html, {
        headers: {
          "Content-Type": "text/html",
          "Content-Disposition": 'inline; filename="quote-preview.html"',
        },
      });
    }
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
