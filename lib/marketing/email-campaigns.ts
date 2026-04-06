import { ClientInvoiceStatus, JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { getAppSettings } from "@/lib/settings";

export type EmailCampaignAudience = {
  type: "all_clients" | "inactive_clients" | "service_type";
  filters?: {
    daysSinceLastBooking?: number;
    jobTypes?: string[];
  };
};

function normalizeAudience(value: unknown): EmailCampaignAudience {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { type: "all_clients" };
  }
  const row = value as Record<string, unknown>;
  const type = row.type === "inactive_clients" || row.type === "service_type" ? row.type : "all_clients";
  const filters = row.filters && typeof row.filters === "object" && !Array.isArray(row.filters)
    ? row.filters as Record<string, unknown>
    : {};
  return {
    type,
    filters: {
      daysSinceLastBooking: Number.isFinite(Number(filters.daysSinceLastBooking)) ? Number(filters.daysSinceLastBooking) : undefined,
      jobTypes: Array.isArray(filters.jobTypes)
        ? filters.jobTypes.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : undefined,
    },
  };
}

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
  const audience = normalizeAudience(audienceInput);
  const now = new Date();
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

  const { recipients, count } = await resolveEmailCampaignRecipients(campaign.audience);
  if (count === 0) {
    await db.emailCampaign.update({
      where: { id: campaign.id },
      data: { status: "sent", sentAt: new Date(), recipientCount: 0 },
    });
    return { sent: 0 };
  }

  const settings = await getAppSettings();
  let sent = 0;
  for (const recipient of recipients) {
    const result = await sendEmailDetailed({
      to: recipient.email,
      subject: campaign.subject,
      html: campaign.htmlBody,
      replyTo: settings.accountsEmail || undefined,
    });
    if (result.ok) sent += 1;
  }

  await db.emailCampaign.update({
    where: { id: campaign.id },
    data: {
      status: "sent",
      sentAt: new Date(),
      recipientCount: sent,
    },
  });

  return { sent };
}

export async function dispatchScheduledEmailCampaigns(now = new Date()) {
  const campaigns = await db.emailCampaign.findMany({
    where: {
      status: "scheduled",
      scheduledAt: { lte: now },
    },
    orderBy: [{ scheduledAt: "asc" }],
    take: 20,
  });

  let dispatched = 0;
  for (const campaign of campaigns) {
    const result = await dispatchEmailCampaignById(campaign.id);
    dispatched += result.sent;
  }
  return { campaigns: campaigns.length, dispatched };
}
