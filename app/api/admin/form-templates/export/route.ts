import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { exportFormTemplates } from "@/lib/forms/template-transfer-server";
import { templateErrorResponse } from "@/lib/forms/template-errors";

/**
 * GET /api/admin/form-templates/export?ids=a,b — download one or several forms
 * as a JSON file (lib/forms/template-transfer.ts: name, service type, tags,
 * schema and a format version; no ids, no presigned links). ADMIN only, like
 * creating forms from such a file.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN]);
    const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean).slice(0, 60);
    const file = await exportFormTemplates(ids);
    const stamp = file.exportedAt.slice(0, 10);
    return new NextResponse(JSON.stringify(file, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="forms-${stamp}.json"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err: unknown) {
    return templateErrorResponse(err);
  }
}
