import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { accountExportResponse, accountListError } from "@/lib/accounts/list/http";

export const dynamic = "force-dynamic";

/** CSV of the Accounts list for the tab, filters and sort on screen. */
export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return await accountExportResponse(session.user, req.nextUrl.searchParams);
  } catch (err) {
    return accountListError(err, "Could not export accounts.");
  }
}
