import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import {
  buildShoppingRunClientReimbursementHtml,
  getShoppingRunBillingContextById,
  renderShoppingRunPdf,
} from "@/lib/inventory/shopping-runs";
import { getAppSettings } from "@/lib/settings";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get("clientId");
    const run = await getShoppingRunBillingContextById(params.id);
    if (!run) {
      return NextResponse.json({ error: "Shopping run not found." }, { status: 404 });
    }
    const allocation =
      run.clientAllocations.find((row) => row.clientId === clientId) ??
      (clientId ? null : run.clientAllocations[0] ?? null);
    if (!allocation) {
      return NextResponse.json({ error: "Client allocation not found." }, { status: 404 });
    }
    const settings = await getAppSettings();
    const html = buildShoppingRunClientReimbursementHtml({
      companyName: settings.companyName,
      logoUrl: settings.logoUrl,
      run,
      clientAllocation: allocation,
    });

    try {
      const pdf = await renderShoppingRunPdf(html);
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="shopping-reimbursement-${run.id}-${(allocation.clientName || "client").replace(/[^\w-]+/g, "-").toLowerCase()}.pdf"`,
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
