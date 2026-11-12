import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { accountListError, cleanerExportResponse } from "@/lib/accounts/list/http";

/** CSV of the forced cleaners list (same access as GET /api/admin/people/cleaners). */
export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return await cleanerExportResponse(session.user, new URL(req.url).searchParams);
  } catch (err) {
    return accountListError(err, "Could not export cleaners.");
  }
}
