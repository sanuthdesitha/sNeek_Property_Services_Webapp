import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import {
  buildShoppingRunPurchaseOrderHtml,
  getShoppingRunByIdForAdmin,
  renderShoppingRunPdf,
} from "@/lib/inventory/shopping-runs";
import { getAppSettings } from "@/lib/settings";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const run = await getShoppingRunByIdForAdmin(params.id);
    if (!run) {
      return NextResponse.json({ error: "Shopping run not found." }, { status: 404 });
    }
    const { searchParams } = new URL(req.url);
    const supplier = searchParams.get("supplier")?.trim() || undefined;
    const orderReference = searchParams.get("orderReference")?.trim() || undefined;
    const settings = await getAppSettings();

    const html = buildShoppingRunPurchaseOrderHtml({
      companyName: settings.companyName,
      logoUrl: settings.logoUrl,
      run,
      supplier,
      orderReference,
    });

    try {
      const pdf = await renderShoppingRunPdf(html);
      const safeSupplier = supplier ? supplier.replace(/[^\w-]+/g, "-").toLowerCase() : "all";
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="purchase-order-${run.id}-${safeSupplier}.pdf"`,
        },
      });
    } catch {
      return NextResponse.json(
        { error: "PDF generation failed. Ensure Playwright browsers are installed." },
        { status: 500 }
      );
    }
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Download failed." }, { status });
  }
}
