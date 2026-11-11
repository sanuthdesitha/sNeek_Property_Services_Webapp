import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { regenerateReport, ReportActionError } from "@/lib/reports/admin-report-actions";

export async function POST(
  req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const url = new URL(req.url);
    let themeId: string | null = url.searchParams.get("themeId");
    if (!themeId) {
      try {
        const body = await req.json();
        if (body && typeof body.themeId === "string") themeId = body.themeId;
      } catch {
        // no body — that's fine
      }
    }

    const { report, requiresAdminInitiation } = await regenerateReport(params.jobId, themeId);

    return NextResponse.json({
      ok: true,
      report,
      autoShare: {
        sent: false,
        recipients: [],
        error: requiresAdminInitiation
          ? "Auto-send disabled by admin communication policy."
          : undefined,
      },
    });
  } catch (err: any) {
    if (err instanceof ReportActionError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
