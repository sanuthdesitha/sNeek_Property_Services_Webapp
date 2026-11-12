import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { accountListError, cleanerListResponse } from "@/lib/accounts/list/http";

/**
 * GET /api/admin/people/cleaners: the People › Cleaners list for viewers
 * admitted through the workforce pack (ops-catalog maps this path to
 * "workforce"; requireRole enforces it with the live policy). The list is
 * forced to cleaners on the server; other roles are unreachable here.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return await cleanerListResponse(session.user, new URL(req.url).searchParams);
  } catch (err) {
    return accountListError(err, "Could not load cleaners.");
  }
}
