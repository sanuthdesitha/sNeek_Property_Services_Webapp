import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { emailCampaignAudienceSchema } from "@/lib/marketing/campaign-audience";
import { computeCampaignReach } from "@/lib/marketing/campaign-reach";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * Before sending (board "Marketing", 2026-11-16): how many addresses the
 * audience will be sent to, and how many are skipped as unsubscribed, on the
 * bounce/complaint list or without an email address. Counts only; no
 * addresses leave the server.
 */
export async function POST(req: Request) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const input = await req.json();
    const audience = emailCampaignAudienceSchema.parse(input?.audience);
    const reach = await computeCampaignReach(audience);
    return NextResponse.json({ reach }, { headers });
  } catch (error: any) {
    const status = error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: status === 400 ? "The audience could not be counted." : error?.message }, { status, headers });
  }
}
