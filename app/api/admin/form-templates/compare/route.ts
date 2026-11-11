import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { compareFormTemplates } from "@/lib/forms/template-transfer-server";
import { templateErrorResponse } from "@/lib/forms/template-errors";

/**
 * GET /api/admin/form-templates/compare?ids=a,b[,c,d] — the library's Compare
 * view, computed on the server (lib/forms/template-compare.ts). Each form is
 * compared as it currently stands (its draft when it has one). Read access
 * matches the library list: ADMIN and OPS_MANAGER. Copying a difference goes
 * through the bulk route (ADMIN, drafts, preview first).
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean).slice(0, 10);
    return NextResponse.json(await compareFormTemplates(ids), { headers: { "Cache-Control": "private, no-store" } });
  } catch (err: unknown) {
    return templateErrorResponse(err);
  }
}
