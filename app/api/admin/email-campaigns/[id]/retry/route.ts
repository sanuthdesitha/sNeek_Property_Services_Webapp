import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { retryFailedEmailCampaign } from "@/lib/marketing/email-campaigns";

/**
 * "Retry the failed" (board "Marketing", 2026-11-16): sends again only to the
 * addresses this campaign recorded as failed, as individual messages through
 * the same campaign sender (email design system, one-click unsubscribe,
 * sending safeguards). Same roles as sending a campaign today.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const result = await retryFailedEmailCampaign(params.id);
    return NextResponse.json(result);
  } catch (error: any) {
    const status = error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not retry the failed sends." }, { status });
  }
}
