import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { readTemplateVersion } from "@/lib/forms/template-history";
import { templateErrorResponse } from "@/lib/forms/template-errors";

/**
 * One version of a form (published or the draft) with its schema, for the
 * builder's read-only view and "changes against live" summary. Read only.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string; versionId: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json(await readTemplateVersion(params.id, params.versionId));
  } catch (err: unknown) {
    return templateErrorResponse(err);
  }
}
