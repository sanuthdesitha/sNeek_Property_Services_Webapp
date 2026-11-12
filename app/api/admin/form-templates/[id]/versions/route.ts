import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { listTemplateVersionHistory } from "@/lib/forms/template-history";
import { templateErrorResponse } from "@/lib/forms/template-errors";

/** Version history of one template: published versions, newest first, plus the draft. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json(await listTemplateVersionHistory(params.id));
  } catch (err: unknown) {
    return templateErrorResponse(err);
  }
}
