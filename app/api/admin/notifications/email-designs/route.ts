import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { DESIGN_HEADERS, designError, designList } from "@/lib/email-design/view";

/**
 * GET: every email on the block layout with its state (standard, published
 * version, draft, raw-HTML template still in use) and what the signed-in
 * person may do. ADMIN and OPS_MANAGER (communications pack, middleware).
 */
export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json(await designList(session), { headers: DESIGN_HEADERS });
  } catch (error) {
    return designError(error);
  }
}
