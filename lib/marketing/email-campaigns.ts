import { ClientInvoiceStatus, JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { renderCampaignContent } from "@/lib/marketing/campaign-render";
import { getAppSettings } from "@/lib/settings";
import { isMarketingSuppressed } from "@/lib/email/suppression";
import { isSegmentId, resolveSegment, type SegmentId } from "@/lib/marketing/segments";
import { CAMPAIGN_SEND_STATUS, skipReasonFor } from "@/lib/marketing/campaign-skips";

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

/**
 * Claim one recipient on the (campaignId, email) ledger. A new row claims it;
 * an existing FAILED row is re-claimed atomically (a retry); any other existing
 * row (SENT, SKIPPED) means this person was already handled and is never
 * emailed twice.
 */
async function claimRecipient(campaignId: string, email: string): Promise<boolean> {
  try {
    await (db as any).campaignSend.create({ data: { campaignId, email, status: CAMPAIGN_SEND_STATUS.sent } });
    return true;
  } catch (err: any) {
    if (err?.code !== "P2002") throw err;
    const reclaimed = await (db as any).campaignSend.updateMany({
      where: { campaignId, email, status: CAMPAIGN_SEND_STATUS.failed },
      data: { status: CAMPAIGN_SEND_STATUS.sent, error: null },
    });
    return Number(reclaimed?.count ?? 0) === 1;
  }
}

/** Record a skipped address (unsubscribed / bounce list) so the campaign can count it. Never throws. */
async function recordSkipped(campaignId: string, email: string) {
  try {
    const reason = await skipReasonFor(email);
    await (db as any).campaignSend.create({ data: { campaignId, email, status: CAMPAIGN_SEND_STATUS.skipped, error: reason } });
  } catch {
    /* already recorded, or the ledger is unavailable: the count is only informational */
  }
}

export type CampaignDispatchResult = { sent: number; suppressed: number; failed: number };

/**
 * Send a campaign as individual messages through sendEmailDetailed with
 * `marketing: true`: the email design system's base layout, campaign footer and
 * one-click unsubscribe, the campaign opt-out check, and the sending
 * safeguards gate (caps, duplicates, quiet hours, emergency stop, the
 * per-send recipient limit). Nothing here bypasses or raises those limits.
 *
 * `onlyEmails` (lowercase) limits the run to those addresses: "Retry the
 * failed" passes the campaign's FAILED ledger rows, and each must still be in
 * the audience.
 */
export async function dispatchEmailCampaignById(campaignId: string, options: { onlyEmails?: string[] } = {}): Promise<CampaignDispatchResult> {
  const campaign = await db.emailCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    throw new Error("Campaign not found.");
  }
  try {

  const resolved = await resolveEmailCampaignRecipients(campaign.audience);
  const only = options.onlyEmails ? new Set(options.onlyEmails.map((email) => email.toLowerCase())) : null;
  const recipients = only ? resolved.recipients.filter((recipient) => only.has(recipient.email.toLowerCase())) : resolved.recipients;
  if (only) {
    // A failed address that left the audience is not emailed again; record why
    // so the campaign stops offering a retry for it.
    const stillMatching = new Set(recipients.map((recipient) => recipient.email.toLowerCase()));
    const gone = Array.from(only).filter((email) => !stillMatching.has(email));
    if (gone.length > 0) {
      await (db as any).campaignSend.updateMany({
        where: { campaignId: campaign.id, email: { in: gone }, status: CAMPAIGN_SEND_STATUS.failed },
        data: { status: CAMPAIGN_SEND_STATUS.skipped, error: "no longer in the audience" },
      });
    }
  }
  const count = recipients.length;
  if (count === 0 && !only) {
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
    // ledger claim; the skip is recorded (SKIPPED, with its reason) so the
    // campaign can count it, and it is never a "contacted" row.
    if (await isMarketingSuppressed(recipient.email)) {
      suppressedCount += 1;
      await recordSkipped(campaign.id, ledgerEmail);
      continue;
    }

    const rendered = await renderCampaignContent({ subject: campaign.subject, body: campaign.htmlBody }, { client: { id: recipient.clientId } });

    // Claim via the unique (campaignId,email) ledger so a crashed/retried
    // dispatch never re-emails someone already contacted (audit: partial-send
    // resume double-email). A FAILED row is re-claimed for a retry.
    if (!(await claimRecipient(campaign.id, ledgerEmail))) continue;

    const result = await sendEmailDetailed({
      to: recipient.email,
      subject: rendered.subject,
      html: rendered.html,
      replyTo: settings.accountsEmail || undefined,
      // Base layout, campaign footer, one-click unsubscribe (List-Unsubscribe).
      marketing: true,
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
      // Keep the row as FAILED (with the reason) so the campaign can count it
      // and "Retry the failed" can send to exactly these people later.
      await (db as any).campaignSend.updateMany({
        where: { campaignId: campaign.id, email: ledgerEmail },
        data: { status: CAMPAIGN_SEND_STATUS.failed, error: (result.error ?? "Not sent").slice(0, 500) },
      });
    }
  }

  // Outcome over the whole ledger, so a retry that clears the last failure
  // marks the campaign sent, and a partial retry keeps it failed.
  const ledger = await countLedger(campaign.id);
  const stillFailed = ledger ? ledger.failed : failed;
  await db.emailCampaign.update({
    where: { id: campaign.id },
    data: {
      status: stillFailed > 0 ? "failed" : "sent",
      sentAt: stillFailed > 0 ? null : new Date(),
      recipientCount: ledger ? ledger.sent : sent,
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

/** SENT / FAILED ledger totals for a campaign; null when the ledger cannot be read. */
async function countLedger(campaignId: string): Promise<{ sent: number; failed: number } | null> {
  try {
    const [sentRows, failedRows] = await Promise.all([
      (db as any).campaignSend.count({ where: { campaignId, status: CAMPAIGN_SEND_STATUS.sent } }),
      (db as any).campaignSend.count({ where: { campaignId, status: CAMPAIGN_SEND_STATUS.failed } }),
    ]);
    if (typeof sentRows !== "number" || typeof failedRows !== "number") return null;
    return { sent: sentRows, failed: failedRows };
  } catch {
    return null;
  }
}

/**
 * "Retry the failed" (board "Marketing"): sends again only to the addresses
 * this campaign recorded as FAILED, through the same path and safeguards.
 * Addresses no longer in the audience, or suppressed since, are not emailed.
 */
export async function retryFailedEmailCampaign(campaignId: string): Promise<CampaignDispatchResult & { retried: number }> {
  const campaign = await db.emailCampaign.findUnique({ where: { id: campaignId }, select: { id: true, status: true } });
  if (!campaign) throw new Error("Campaign not found.");
  if (campaign.status !== "failed") throw new Error("Only a campaign with failed sends can be retried.");
  const claim = await db.emailCampaign.updateMany({ where: { id: campaignId, status: "failed" }, data: { status: "sending" } });
  if (claim.count !== 1) throw new Error("This campaign is already being sent.");
  try {
    const failedRows = (await (db as any).campaignSend.findMany({
      where: { campaignId, status: CAMPAIGN_SEND_STATUS.failed },
      select: { email: true },
    })) as Array<{ email: string }>;
    const emails = failedRows.map((row) => row.email.toLowerCase());
    if (emails.length === 0) {
      await db.emailCampaign.update({ where: { id: campaignId }, data: { status: "sent", sentAt: new Date() } });
      return { sent: 0, suppressed: 0, failed: 0, retried: 0 };
    }
    const result = await dispatchEmailCampaignById(campaignId, { onlyEmails: emails });
    return { ...result, retried: emails.length };
  } catch (error) {
    await db.emailCampaign.update({ where: { id: campaignId }, data: { status: "failed", sentAt: null } }).catch(() => undefined);
    throw error;
  }
}

/**
 * A campaign more than a day past its send time is left scheduled for a person
 * to reschedule. After a worker outage it must not go out days or weeks late.
 */
export const CAMPAIGN_MAX_OVERDUE_MS = 24 * 60 * 60_000;

export async function dispatchScheduledEmailCampaigns(now = new Date()) {
  const oldestSendable = new Date(now.getTime() - CAMPAIGN_MAX_OVERDUE_MS);
  const campaigns = await db.emailCampaign.findMany({
    where: {
      status: "scheduled",
      scheduledAt: { lte: now, gte: oldestSendable },
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
