import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getPayrollSummary, buildPayslipHtml } from "@/lib/finance/payroll";
import { getAppSettings } from "@/lib/settings";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const cleanerId = req.nextUrl.searchParams.get("cleanerId")?.trim() || "";
    const startDate = req.nextUrl.searchParams.get("startDate")?.trim() || "";
    const endDate = req.nextUrl.searchParams.get("endDate")?.trim() || "";
    if (!cleanerId || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return NextResponse.json({ error: "Valid cleanerId, startDate, and endDate are required." }, { status: 400 });
    }

    const [rows, settings] = await Promise.all([
      getPayrollSummary({ startDate, endDate }),
      getAppSettings(),
    ]);
    const row = rows.find((entry) => entry.cleaner.id === cleanerId);
    if (!row) {
      return NextResponse.json({ error: "Cleaner payroll record not found." }, { status: 404 });
    }

    const html = buildPayslipHtml({
      companyName: settings.companyName,
      logoUrl: settings.logoUrl,
      cleaner: row.cleaner,
      rows: row.jobs,
      adjustments: row.adjustments,
      totals: row.totals,
      startDate,
      endDate,
    });

    const { chromium } = await import("playwright");
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    try {
      browser = await chromium.launch().catch(async () => chromium.launch({ channel: "msedge" }).catch(async () => chromium.launch({ channel: "chrome" })));
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle" });
      const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "16px", right: "16px", bottom: "16px", left: "16px" } });
      const fileName = `${(row.cleaner.name?.trim() || row.cleaner.email.split("@")[0] || "cleaner").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${startDate}-${endDate}.pdf`;
      return new NextResponse(Buffer.from(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${fileName}"`,
          "Cache-Control": "no-store",
        },
      });
    } finally {
      await browser?.close().catch(() => {});
    }
  } catch (error: any) {
    const status = error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not generate payslip." }, { status });
  }
}
