import { ClientInvoiceStatus, JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { renderCampaignContent } from "@/lib/marketing/campaign-render";
import { getAppSettings } from "@/lib/settings";
import { isSuppressed } from "@/lib/email/suppression";
import { isSegmentId, resolveSegment, type SegmentId } from "@/lib/marketing/segments";

export type { EmailCampaignAudience } from "./campaign-audience";
import { normalizeCampaignAudience, resolveSingleCampaignRecipient } from "./campaign-audience";

function primaryClientEmail(client: {
  email: string | null;
  users: Array<{ email: string; name: string | null }>;
}) {
  return client.users.find((user) => user.email?.trim())?.email?.trim() || client.email?.trim() || "";
}

export async function listEmailCampaigns() {
  return db.emailCampaign.findMany({
    include: {
      createdBy: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function resolveEmailCampaignRecipients(audienceInput: unknown) {
  const audience = normalizeCampaignAudience(audienceInput);
  if (audience.type === "single_recipient") {
    const recipients = await resolveSingleCampaignRecipient(audience.filters!.email!);
    return { audience, recipients, count: recipients.length };
  }
  const now = new Date();

  // Named-segment audiences delegate wholesale to lib/marketing/segments.ts —
  // the legacy ad-hoc filters below stay for campaigns saved before segments.
  if (audience.type === "segment" && audience.filters?.segmentId) {
    const resolved = await resolveSegment(audience.filters.segmentId, now);
    const recipients = resolved.recipients
      .filter((recipient) => Boolean(recipient.email))
      .map((recipient) => ({
        clientId: recipient.clientId ?? "",
        clientName: recipient.name,
        email: recipient.email,
      }));
    return { audience, recipients, count: recipients.length };
  }

  const clients = await db.client.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      email: true,
      users: {
        where: { isActive: true },
        select: { email: true, name: true },
      },
      properties: {
        select: {
          jobs: {
            where: { status: { in: [JobStatus.COMPLETED, JobStatus.INVOICED] } },
            select: { scheduledDate: true, jobType: true },
            orderBy: { scheduledDate: "desc" },
          },
        },
      },
      invoices: {
        where: { status: { in: [ClientInvoiceStatus.PAID, ClientInvoiceStatus.SENT, ClientInvoiceStatus.APPROVED] } },
        select: { createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  const recipients = clients.filter((client) => {
    const email = primaryClientEmail(client);
    if (!email) return false;
    const jobs = client.properties.flatMap((property) => property.jobs);
    if (audience.type === "inactive_clients") {
      const days = Math.max(1, Number(audience.filters?.daysSinceLastBooking ?? 60));
      const latest = jobs[0]?.scheduledDate ?? client.invoices[0]?.createdAt ?? null;
      if (!latest) return true;
      return now.getTime() - new Date(latest).getTime() >= days * 24 * 60 * 60 * 1000;
    }
    if (audience.type === "service_type") {
      const allowed = new Set((audience.filters?.jobTypes ?? []).map((item) => item.trim()).filter(Boolean));
      if (allowed.size === 0) return false;
      return jobs.some((job) => allowed.has(job.jobType));
    }
    return true;
  }).map((client) => ({
    clientId: client.id,
    clientName: client.name,
    email: primaryClientEmail(client),
  }));

  const unique = Array.from(new Map(recipients.map((recipient) => [recipient.email.toLowerCase(), recipient])).values());
  return {
    audience,
    recipients: unique,
    count: unique.length,
  };
}

export async function dispatchEmailCampaignById(campaignId: string) {
  const campaign = await db.emailCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    throw new Error("Campaign not found.");
  }
  try {

  const { recipients, count } = await resolveEmailCampaignRecipients(campaign.audience);
  if (count === 0) {
    await db.emailCampaign.update({
      where: { id: campaign.id },
      data: { status: "sent", sentAt: new Date(), recipientCount: 0 },
    });
    return { sent: 0, suppressed: 0, failed: 0 };
  }

  const settings = await getAppSettings();
  let sent = 0;
  let suppressedCount = 0;
  let failed = 0;
  for (const recipient of recipients) {
    const ledgerEmail = recipient.email.toLowerCase();
    // Campaigns are non-transactional marketing — bounced / complained /
    // unsubscribed addresses must never be re-emailed. Checked BEFORE the
    // ledger claim so a suppressed address leaves no phantom "contacted" row.
    if (await isSuppressed(recipient.email)) {
      suppressedCount += 1;
      continue;
    }

    const rendered = await renderCampaignContent({ subject: campaign.subject, body: campaign.htmlBody }, { client: { id: recipient.clientId } });

    // Claim via the unique (campaignId,email) ledger so a crashed/retried
    // dispatch never re-emails someone already contacted (audit: partial-send
    // resume double-email). Skip if a claim already exists.
    let alreadyContacted = false;
    try {
      await (db as any).campaignSend.create({
        data: { campaignId: campaign.id, email: ledgerEmail, status: "SENT" },
      });
    } catch (err: any) {
      if (err?.code === "P2002") alreadyContacted = true;
      else throw err;
    }
    if (alreadyContacted) continue;

    const result = await sendEmailDetailed({
      to: recipient.email,
      subject: rendered.subject,
      html: rendered.html,
      replyTo: settings.accountsEmail || undefined,
    });
    if (result.ok) {
      sent += 1;
      // Record the provider message id so Resend webhook events can be mapped
      // back to this campaign (analytics + suppression feedback).
      if (result.externalId) {
        await (db as any).campaignSend.updateMany({
          where: { campaignId: campaign.id, email: ledgerEmail },
          data: { externalId: result.externalId },
        }).catch(() => undefined);
      }
    } else {
      failed += 1;
      // Drop the claim so a later run can retry this recipient.
      await (db as any).campaignSend.deleteMany({
        where: { campaignId: campaign.id, email: ledgerEmail },
      });
    }
  }

  await db.emailCampaign.update({
    where: { id: campaign.id },
    data: {
      status: failed > 0 ? "failed" : "sent",
      sentAt: failed > 0 ? null : new Date(),
      recipientCount: sent,
    },
  });

  return { sent, suppressed: suppressedCount, failed };
  } catch (error) {
    // Rendering fails before claiming a recipient. Keep existing successful
    // claims intact, but never leave a scheduled campaign labelled sending.
    await db.emailCampaign.update({ where: { id: campaign.id }, data: { status: "failed", sentAt: null } }).catch(() => undefined);
    throw error;
  }
}

export async function dispatchScheduledEmailCampaigns(now = new Date()) {
  const campaigns = await db.emailCampaign.findMany({
    where: {
      status: "scheduled",
      scheduledAt: { lte: now },
      // The newer marketing engine (dispatchDueCampaigns) claims on the
      // `campaignStatus` dimension of THIS SAME row. If it owns the row, defer
      // to it — otherwise a row that is both legacy-"scheduled" and
      // new-engine-SCHEDULED would be sent twice (once per dispatcher).
      campaignStatus: { notIn: ["SCHEDULED", "SENDING", "SENT"] },
    },
    orderBy: [{ scheduledAt: "asc" }],
    take: 20,
  });

  let dispatched = 0;
  let failed = 0;
  for (const campaign of campaigns) {
    // Atomic claim (legacy status path): flip "scheduled" -> "sending" with a
    // conditional updateMany so two overlapping ticks / app instances can't both
    // dispatch the same campaign. Only the caller that actually transitions the
    // row (count === 1) proceeds; a racing caller skips it. dispatchEmailCampaignById
    // sets status -> "sent" on success; a failure leaves it "sending" (not
    // re-picked by this query), preventing an accidental resend.
    const claim = await db.emailCampaign.updateMany({
      where: {
        id: campaign.id,
        status: "scheduled",
        campaignStatus: { notIn: ["SCHEDULED", "SENDING", "SENT"] },
      },
      data: { status: "sending" },
    });
    if (claim.count !== 1) continue;

    try {
      const result = await dispatchEmailCampaignById(campaign.id);
      dispatched += result.sent;
      if (result.failed) failed += 1;
    } catch {
      failed += 1;
      // The dispatch records its own failure. Other scheduled campaigns must
      // still get their turn; failed recipients are never blindly replayed.
    }
  }
  return { campaigns: campaigns.length, dispatched, failed };
}
