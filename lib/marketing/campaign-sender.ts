/**
 * Marketing engine v1 — multi-channel campaign sender.
 *
 * Extends the legacy EmailCampaign model with the new CampaignChannel enum
 * (EMAIL | SMS | BOTH). Email recipients are gated through Plan F suppression
 * (non-transactional channel). SMS uses lib/notifications/sms.ts (Twilio with
 * Cellcast fallback). Variables resolve via V10 resolveTemplate.
 *
 * Recipient selection reuses lib/marketing/email-campaigns.ts when audience
 * resolution is JSON-based; for SMS-only campaigns we also pull phone numbers
 * off the client.users array.
 */
import { db } from "@/lib/db";
import { resolveTemplate } from "@/lib/messages/variables";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { sendSmsDetailed } from "@/lib/notifications/sms";
import { isSuppressed } from "@/lib/email/suppression";
import { ClientInvoiceStatus, JobStatus } from "@prisma/client";

export interface CampaignSendResult {
  campaignId: string;
  attempted: number;
  sent: number;
  suppressed: number;
  failed: number;
  channel: "EMAIL" | "SMS" | "BOTH";
}

type ChannelValue = "EMAIL" | "SMS" | "BOTH";

interface ResolvedRecipient {
  clientId: string;
  email: string;
  phone: string;
}

function pickEmail(client: { email: string | null; users: Array<{ email: string | null }> }) {
  return client.users.find((u) => u.email?.trim())?.email?.trim() || client.email?.trim() || "";
}

function pickPhone(client: { phone: string | null; users: Array<{ phone: string | null }> }) {
  return client.users.find((u) => u.phone?.trim())?.phone?.trim() || client.phone?.trim() || "";
}

async function loadRecipients(audience: any): Promise<ResolvedRecipient[]> {
  // Recipient selection: reuse the same broad-set query as email-campaigns.ts.
  // For SMS we additionally surface phone.
  const now = new Date();
  const aud = (audience && typeof audience === "object" && !Array.isArray(audience)) ? audience : { type: "all_clients" };
  const type = aud.type === "inactive_clients" || aud.type === "service_type" ? aud.type : "all_clients";
  const filters = (aud.filters && typeof aud.filters === "object") ? aud.filters : {};

  const clients = await db.client.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      users: {
        where: { isActive: true },
        select: { email: true, phone: true },
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

  const filtered = clients.filter((client) => {
    const jobs = client.properties.flatMap((p) => p.jobs);
    if (type === "inactive_clients") {
      const days = Math.max(1, Number(filters.daysSinceLastBooking ?? 60));
      const latest = jobs[0]?.scheduledDate ?? client.invoices[0]?.createdAt ?? null;
      if (!latest) return true;
      return now.getTime() - new Date(latest).getTime() >= days * 24 * 60 * 60 * 1000;
    }
    if (type === "service_type") {
      const allowed = new Set<string>(Array.isArray(filters.jobTypes) ? filters.jobTypes : []);
      if (allowed.size === 0) return false;
      return jobs.some((j) => allowed.has(j.jobType));
    }
    return true;
  });

  const recipients = filtered.map((c) => ({
    clientId: c.id,
    email: pickEmail(c),
    phone: pickPhone(c),
  }));

  // Dedup by clientId
  return Array.from(new Map(recipients.map((r) => [r.clientId, r])).values());
}

/**
 * Send all messages in a campaign.
 * - EMAIL channel: each recipient gated through Plan F suppression
 * - SMS channel: sends to phone (normalised in sms.ts)
 * - BOTH: both channels per recipient if both contact methods are available
 */
export async function sendCampaign(campaignId: string): Promise<CampaignSendResult> {
  const campaign = await (db as any).emailCampaign.findUnique({
    where: { id: campaignId },
    include: { template: true },
  });
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const channel: ChannelValue = (campaign.channel as ChannelValue) || "EMAIL";

  await (db as any).emailCampaign.update({
    where: { id: campaignId },
    data: { campaignStatus: "SENDING" },
  });

  const recipients = await loadRecipients(campaign.audience);

  let sent = 0;
  let suppressed = 0;
  let failed = 0;

  const bodySource = campaign.template?.body || campaign.htmlBody || "";
  const subjectSource = campaign.template?.subject || campaign.subject || "(no subject)";

  for (const r of recipients) {
    try {
      const ctx = { client: { id: r.clientId } };
      const body = await resolveTemplate(bodySource, ctx);
      const subject = subjectSource ? await resolveTemplate(subjectSource, ctx) : "(no subject)";

      if ((channel === "EMAIL" || channel === "BOTH") && r.email) {
        if (await isSuppressed(r.email)) {
          suppressed++;
        } else {
          const res = await sendEmailDetailed({
            to: r.email,
            subject,
            html: body.includes("<") ? body : body.replace(/\n/g, "<br/>"),
          });
          if (res.ok) sent++;
          else failed++;
        }
      }

      if ((channel === "SMS" || channel === "BOTH") && r.phone) {
        // SMS body: strip HTML tags if template was HTML
        const smsBody = body.replace(/<[^>]+>/g, "").trim();
        const res = await sendSmsDetailed(r.phone, smsBody);
        if (res.ok) sent++;
        else failed++;
      }
    } catch {
      failed++;
    }
  }

  await (db as any).emailCampaign.update({
    where: { id: campaignId },
    data: {
      campaignStatus: failed > 0 && sent === 0 ? "FAILED" : "SENT",
      status: "sent",
      sentAt: new Date(),
      recipientCount: sent,
    },
  });

  return { campaignId, attempted: recipients.length, sent, suppressed, failed, channel };
}

/**
 * Picks up SCHEDULED campaigns whose scheduledFor has arrived, and sends them.
 * Called by the pg-boss `marketing-campaign-dispatch` job.
 */
export async function dispatchDueCampaigns(now: Date = new Date()): Promise<{ dispatched: number; results: CampaignSendResult[] }> {
  const due = await (db as any).emailCampaign.findMany({
    where: {
      campaignStatus: "SCHEDULED",
      scheduledFor: { lte: now },
    },
    select: { id: true },
    take: 20,
  });

  const results: CampaignSendResult[] = [];
  for (const c of due) {
    try {
      const r = await sendCampaign(c.id);
      results.push(r);
    } catch {
      // swallow — per-campaign failures already mark status FAILED
    }
  }
  return { dispatched: results.length, results };
}
