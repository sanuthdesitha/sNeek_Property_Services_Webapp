import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { buildQuoteHtml } from "@/lib/pricing/quote-report";
import { getAppSettings } from "@/lib/settings";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const [quote, settings] = await Promise.all([
      db.quote.findUnique({
      where: { id: params.id },
      include: {
        client: { select: { name: true, email: true } },
        lead: { select: { name: true, email: true } },
      },
      }),
      getAppSettings(),
    ]);
    if (!quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    const html = buildQuoteHtml(quote, {
      companyName: settings.companyName,
      logoUrl: settings.logoUrl,
    });

    try {
      const { renderPdfFromHtml } = await import("@/lib/reports/pdf");
      const pdf = await renderPdfFromHtml(html, "quote PDF generation");

      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="quote-${quote.id}.pdf"`,
        },
      });
    } catch {
      return new NextResponse(html, {
        headers: {
          "Content-Type": "text/html",
          "Content-Disposition": `inline; filename="quote-${quote.id}.html"`,
        },
      });
    }
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
