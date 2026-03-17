import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import {
  buildShoppingListHtml,
  getShoppingListGrouped,
  renderShoppingListPdf,
} from "@/lib/inventory/shopping-list-report";

function sanitizeScope(rawScope: string | null): string {
  return rawScope && rawScope.trim() ? rawScope.trim() : "all";
}

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const scope = sanitizeScope(searchParams.get("scope"));

    const [grouped, settings] = await Promise.all([getShoppingListGrouped(scope), getAppSettings()]);
    const property = scope === "all"
      ? null
      : await db.property.findUnique({ where: { id: scope }, select: { name: true } });
    const scopeLabel = scope === "all" ? "All properties" : property?.name ?? "Selected property";
    const html = buildShoppingListHtml({
      companyName: settings.companyName,
      logoUrl: settings.logoUrl,
      scopeLabel,
      grouped,
    });

    try {
      const pdf = await renderShoppingListPdf(html);
      const fileLabel = scope === "all" ? "all-properties" : scope;
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="shopping-list-${fileLabel}.pdf"`,
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
    return NextResponse.json({ error: err.message }, { status });
  }
}
