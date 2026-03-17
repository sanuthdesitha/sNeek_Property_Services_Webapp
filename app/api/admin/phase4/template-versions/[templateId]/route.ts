import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { createTemplateVersion, listTemplateVersions } from "@/lib/phase4/template-versions";

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

export async function POST(
  _req: NextRequest,
  { params }: { params: { templateId: string } }
) {
  try {
    await requireRole([Role.ADMIN]);
    const created = await createTemplateVersion(params.templateId);
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not create template version." }, { status });
  }
}

