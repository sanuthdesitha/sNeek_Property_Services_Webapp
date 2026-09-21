import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { emailCampaignAudienceSchema } from "@/lib/marketing/campaign-audience";
import { resolveEmailCampaignRecipients } from "@/lib/marketing/email-campaigns";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function POST(req: Request) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const input = await req.json();
    const audience = emailCampaignAudienceSchema.parse(input.audience);
    const result = await resolveEmailCampaignRecipients(audience);
    return NextResponse.json({ ...result, recipients: result.recipients.map(({ clientId, clientName, email }) => ({ clientId, clientName, email })) }, { headers });
  } catch (error: any) {
    const status = error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not preview recipients." }, { status, headers });
  }
}
