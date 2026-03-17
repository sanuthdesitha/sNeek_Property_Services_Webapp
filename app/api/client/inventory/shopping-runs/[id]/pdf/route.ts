import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { isClientModuleEnabled } from "@/lib/portal-access";
import { db } from "@/lib/db";
import {
  buildShoppingRunHtml,
  getShoppingRunForOwner,
  renderShoppingRunPdf,
} from "@/lib/inventory/shopping-runs";

async function getClientId(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { clientId: true } });
  return user?.clientId ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLIENT]);
    const settings = await getAppSettings();
    if (!isClientModuleEnabled(settings, "shopping")) {
      return NextResponse.json({ error: "Shopping is not available for client users." }, { status: 403 });
    }
    const clientId = await getClientId(session.user.id);
    const run = await getShoppingRunForOwner({
      id: params.id,
      ownerScope: "CLIENT",
      ownerUserId: session.user.id,
      clientId,
    });
    if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
    const html = buildShoppingRunHtml({
      companyName: settings.companyName,
      logoUrl: settings.logoUrl,
      title: "Shopping Run",
      run,
    });
    try {
      const pdf = await renderShoppingRunPdf(html);
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="shopping-run-${run.id}.pdf"`,
        },
      });
    } catch {
      return NextResponse.json(
        { error: "PDF generation failed. Ensure Playwright browsers are installed." },
        { status: 500 }
      );
    }
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Download failed." }, { status });
  }
}
