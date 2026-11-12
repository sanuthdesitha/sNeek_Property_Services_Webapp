import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { reportBulkSchema, runReportBulk } from "@/lib/reports/report-bulk";

export const dynamic = "force-dynamic";

/**
 * Bulk visibility / regenerate / delete on selected client reports, with one
 * outcome per row. Same guard as the single-report routes (ADMIN and
 * OPS_MANAGER; operations managers also need the reports feature at manage
 * level, enforced by the session guard).
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = reportBulkSchema.parse(await req.json().catch(() => null));
    return NextResponse.json(await runReportBulk(body, session.user.id));
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid bulk request." }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED") return NextResponse.json({ error: message }, { status: 401 });
    if (message === "FORBIDDEN") return NextResponse.json({ error: message }, { status: 403 });
    return NextResponse.json({ error: "Could not run the bulk action." }, { status: 500 });
  }
}
