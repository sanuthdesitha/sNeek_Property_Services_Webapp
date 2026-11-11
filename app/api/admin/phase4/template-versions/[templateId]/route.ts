import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { LEGACY_TEMPLATE_VERSION_WRITES_GONE, listTemplateVersions } from "@/lib/phase4/template-versions";

/**
 * Old template-versions API (no screen). GET still lists the sibling "… vN"
 * templates for anything external that reads it. POST (create a sibling
 * version and deactivate the rest) answers 410: it changed which form jobs
 * resolve to outside the Forms library's draft / publish rules.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { templateId: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const rows = await listTemplateVersions(params.templateId);
    return NextResponse.json(rows);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load template versions." }, { status });
  }
}

export async function POST() {
  try {
    await requireRole([Role.ADMIN]);
    return NextResponse.json({ error: LEGACY_TEMPLATE_VERSION_WRITES_GONE, gone: true }, { status: 410 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Request failed." : message }, { status });
  }
}
