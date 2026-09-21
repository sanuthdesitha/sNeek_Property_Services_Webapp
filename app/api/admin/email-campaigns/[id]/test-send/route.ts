import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { getAppSettings } from "@/lib/settings";
import { resolveEmailCampaignRecipients } from "@/lib/marketing/email-campaigns";
import { renderCampaignContent } from "@/lib/marketing/campaign-render";
import { extractVariablePaths } from "@/lib/messages/variables";

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
 *  - personalization uses the first actual client in the selected audience;
 *    delivery is still exclusively to the signed-in admin, never that client
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

    const { recipients } = await resolveEmailCampaignRecipients(campaign.audience);
    const recipient = recipients.find(value => Boolean(value.clientId));
    if (!recipient && extractVariablePaths(`${campaign.subject}\n${campaign.htmlBody}`).length > 0) {
      return NextResponse.json({ error: "No eligible client is available to personalize this test. Select an audience containing a client and try again." }, { status: 400 });
    }
    const rendered = await renderCampaignContent({ subject: campaign.subject, body: campaign.htmlBody }, recipient ? { client: { id: recipient.clientId } } : {});
    const settings = await getAppSettings();
    const result = await sendEmailDetailed({
      to,
      subject: `[TEST] ${rendered.subject}`,
      html: rendered.html,
      replyTo: settings.accountsEmail || undefined,
      transactional: true,
      critical: true,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Test send failed." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, to, previewClientName: recipient?.clientName ?? null });
  } catch (error: any) {
    const status = error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not send test." }, { status });
  }
}
