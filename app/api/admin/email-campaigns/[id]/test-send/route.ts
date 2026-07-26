import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * "Send test to me" — renders the campaign exactly as a recipient would receive
 * it (same sendEmailDetailed path, same branded wrap) and delivers ONE copy to
 * the signed-in admin's own address.
 *
 * Deliberate differences from a real send:
 *  - subject is prefixed [TEST] so it can never be mistaken for the live send
 *  - `transactional: true`, because the admin's own address may legitimately sit
 *    on the suppression list and a self-addressed preview is not marketing
 *  - no CampaignSend ledger row is written, so the test does not consume the
 *    recipient claim or count towards the campaign's `sent` analytics
 *  - {{variables}} are NOT resolved: there is no client context for a test, so
 *    the tokens stay visible and the admin can see exactly where they land
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const to = session.user.email?.trim();
    if (!to) {
      return NextResponse.json({ error: "Your account has no email address on file." }, { status: 400 });
    }

    const campaign = await db.emailCampaign.findUnique({ where: { id: params.id } });
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    }

    const settings = await getAppSettings();
    const result = await sendEmailDetailed({
      to,
      subject: `[TEST] ${campaign.subject}`,
      html: campaign.htmlBody,
      replyTo: settings.accountsEmail || undefined,
      transactional: true,
      critical: true,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Test send failed." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, to });
  } catch (error: any) {
    const status = error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not send test." }, { status });
  }
}
