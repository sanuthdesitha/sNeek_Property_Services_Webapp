import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { buildDamageReportHtml } from "@/lib/reports/damage-report";
import {
  getDamageInvestigationForClient,
  type DamageAudience,
} from "@/lib/damage/investigation";
import { renderPdfFromHtml } from "@/lib/reports/pdf";

/**
 * D3 — download the damage report.
 *
 * One route serves admin and client, and the AUDIENCE IS DERIVED FROM THE
 * SESSION, never from a query parameter. The internal copy carries per-item
 * repair costs; if the audience were a parameter, any client could ask for it
 * by editing the URL. This mirrors the QA report route, which made the same
 * decision for the same reason.
 *
 * A client additionally has to clear the same gate as the on-screen page — the
 * report must be released, non-draft, and on one of their own properties — and
 * that check reuses `getDamageInvestigationForClient` rather than
 * reimplementing the rule, so the PDF can never be obtainable when the page is
 * not.
 *
 * `?format=html` returns the document itself, which is useful for previewing
 * without paying for a PDF render.
 */
export async function GET(req: Request, { params }: { params: { reportId: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.CLIENT]);

    let audience: DamageAudience = "ADMIN";

    if (session.user.role === Role.CLIENT) {
      audience = "CLIENT";
      const user = await db.user.findUnique({
        where: { id: session.user.id },
        select: { clientId: true },
      });
      // Same gate as the page: released, not a draft, own property. A failure
      // here is a 404, not a 403 — a 403 would confirm the report exists.
      const allowed = user?.clientId
        ? await getDamageInvestigationForClient({
            reportId: params.reportId,
            clientId: user.clientId,
          })
        : null;
      if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const built = await buildDamageReportHtml(params.reportId, audience);
    if (!built) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const wantsHtml = new URL(req.url).searchParams.get("format") === "html";
    if (wantsHtml) {
      return new NextResponse(built.html, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    const pdf = await renderPdfFromHtml(built.html, `damage report ${params.reportId}`);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="damage-report-${params.reportId}.pdf"`,
        "Cache-Control": "no-store, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Could not build the damage report." }, { status: 503 });
  }
}
