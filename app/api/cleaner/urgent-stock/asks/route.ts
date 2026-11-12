import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { listCleanerPurchaseAsks } from "@/lib/inventory/urgent-stock-ask-view";
import { urgentFailure, urgentJson } from "@/lib/inventory/urgent-stock-http";

export const dynamic = "force-dynamic";

/** GET ?jobId= — the cleaner's own waiting and accepted "buy" asks. */
export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const asks = await listCleanerPurchaseAsks(session.user, req.nextUrl.searchParams.get("jobId"));
    return urgentJson({ asks });
  } catch (error) {
    return urgentFailure(error, "Could not load requests.");
  }
}
