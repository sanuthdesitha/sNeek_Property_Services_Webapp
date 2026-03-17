import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { rollbackTemplateVersion } from "@/lib/phase4/template-versions";

const schema = z.object({
  targetTemplateId: z.string().trim().min(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { templateId: string } }
) {
  try {
    await requireRole([Role.ADMIN]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const updated = await rollbackTemplateVersion(params.templateId, body.targetTemplateId);
    return NextResponse.json(updated);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not rollback template version." }, { status });
  }
}

