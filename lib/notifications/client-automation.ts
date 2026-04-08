import PgBoss from "pg-boss";
import { resolveAppUrl } from "@/lib/app-url";
import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { sendSmsDetailed } from "@/lib/notifications/sms";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";

const REVIEW_THROTTLE_MS = 3 * 24 * 60 * 60 * 1000;
const DATABASE_URL = process.env.DATABASE_URL?.trim() || "";

type AutomationContext = NonNullable<Awaited<ReturnType<typeof getAutomationContext>>>;
type AutomationClient = AutomationContext["property"]["client"];
type AutomationRule = AutomationClient["automationRules"][number];
type AutomationRecipient = AutomationClient["users"][number];
type AutomationCleaner = AutomationContext["assignments"][number]["user"] | undefined;

function formatJobType(value: string) {
  return value.replaceAll("_", " ").trim();
}

function formatDate(value: Date | null | undefined) {
  if (!value) return "TBC";
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function renderTemplate(template: string, variables: Record<string, string>) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    return variables[key] ?? "";
  });
}

async function getAutomationContext(jobId: string) {
  return db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      jobNumber: true,
      jobType: true,
      scheduledDate: true,
      property: {
        select: {
          id: true,
          name: true,
          address: true,
          suburb: true,
          client: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              lastReviewRequestSentAt: true,
              users: {
                where: { role: Role.CLIENT, isActive: true },
                select: { id: true, name: true, email: true, phone: true },
                orderBy: { createdAt: "asc" },
              },
              automationRules: {
                where: { isEnabled: true },
                include: { template: true },
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      },
      assignments: {
        where: { removedAt: null },
        select: {
          isPrimary: true,
          user: { select: { id: true, name: true, phone: true } },
        },
      },
      feedback: {
        select: {
          id: true,
          token: true,
          tokenExpiresAt: true,
          submittedAt: true,
        },
      },
    },
  });
}

async function ensureFeedbackRecord(jobId: string, clientId: string) {
  const tokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return db.jobFeedback.upsert({
    where: { jobId },
    create: { jobId, clientId, tokenExpiresAt },
    update: { tokenExpiresAt },
  });
}

async function logEmailNotification(input: {
  recipientUserId: string;
  jobId: string;
  subject: string;
  body: string;
  result: Awaited<ReturnType<typeof sendEmailDetailed>>;
}) {
  await db.notification.create({
    data: {
      userId: input.recipientUserId,
      jobId: input.jobId,
      channel: NotificationChannel.EMAIL,
      subject: input.subject,
      body: input.body,
      status: input.result.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
      sentAt: input.result.ok ? new Date() : undefined,
      errorMsg: input.result.ok ? undefined : input.result.error ?? "Email delivery failed.",
      externalId: input.result.externalId ?? undefined,
      deliveryStatus: input.result.ok ? "PENDING" : undefined,
    },
  });
}

async function logSmsNotification(input: {
  recipientUserId: string;
  jobId: string;
  subject: string;
  body: string;
  result: Awaited<ReturnType<typeof sendSmsDetailed>>;
}) {
  if (input.result.status !== "sent" && input.result.status !== "failed") return;

  await db.notification.create({
    data: {
      userId: input.recipientUserId,
      jobId: input.jobId,
      channel: NotificationChannel.SMS,
      subject: input.subject,
      body: input.body,
      status: input.result.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
      sentAt: input.result.ok ? new Date() : undefined,
      errorMsg: input.result.ok ? undefined : input.result.error ?? "SMS delivery failed.",
    },
  });
}

async function buildAutomationPayload(input: {
  context: AutomationContext;
  client: AutomationClient;
  recipient: AutomationRecipient;
  cleaner: AutomationCleaner;
  rule: AutomationRule;
  jobId: string;
}) {
  const feedback = await ensureFeedbackRecord(input.jobId, input.client.id);
  const feedbackUrl = resolveAppUrl(`/feedback/${feedback.token}`);
  const variables = {
    client_name: input.client.name || input.recipient.name || "Client",
    property_name: input.context.property.name,
    property_address: input.context.property.address,
    cleaner_name: input.cleaner?.name || "Your cleaner",
    next_clean_date: formatDate(input.context.scheduledDate),
    job_type: formatJobType(input.context.jobType),
    feedback_url: feedbackUrl,
    job_number: input.context.jobNumber || "",
  };

  return {
    subject: renderTemplate(input.rule.template?.subject || `${input.context.property.name} update`, variables),
    body: renderTemplate(input.rule.template?.body || "", variables),
  };
}

function getRuleSkipReason(input: {
  rule: AutomationRule;
  context: AutomationContext;
  client: AutomationClient;
  now: number;
}) {
  if (input.rule.jobType && input.rule.jobType !== input.context.jobType) {
    return "job_type_mismatch";
  }
  if (!input.rule.template || !input.rule.template.isActive) {
    return "missing_template";
  }
  if (input.rule.triggerType === "POST_JOB_REVIEW" && input.client.lastReviewRequestSentAt) {
    const diff = input.now - new Date(input.client.lastReviewRequestSentAt).getTime();
    if (diff < REVIEW_THROTTLE_MS) {
      return "throttled";
    }
  }
  return null;
}

async function dispatchRuleChannels(input: {
  rule: AutomationRule;
  recipient: AutomationRecipient;
  jobId: string;
  subject: string;
  body: string;
}) {
  let sent = 0;
  const skipped: string[] = [];

  if (input.rule.channel === "EMAIL" || input.rule.channel === "BOTH") {
    if (input.recipient.email) {
      const result = await sendEmailDetailed({
        to: input.recipient.email,
        subject: input.subject,
        html: `<p>${input.body.replaceAll("\n", "<br />")}</p>`,
      });
      await logEmailNotification({
        recipientUserId: input.recipient.id,
        jobId: input.jobId,
        subject: input.subject,
        body: input.body,
        result,
      });
      if (result.ok) sent += 1;
    } else {
      skipped.push("missing_email");
    }
  }

  if (input.rule.channel === "SMS" || input.rule.channel === "BOTH") {
    if (input.recipient.phone) {
      const result = await sendSmsDetailed(input.recipient.phone, input.body);
      await logSmsNotification({
        recipientUserId: input.recipient.id,
        jobId: input.jobId,
        subject: input.subject,
        body: input.body,
        result,
      });
      if (result.ok) sent += 1;
    } else {
      skipped.push("missing_phone");
    }
  }

  return { sent, skipped };
}

async function markReviewSentIfNeeded(rule: AutomationRule, clientId: string) {
  if (rule.triggerType !== "POST_JOB_REVIEW") return;
  await db.client.update({
    where: { id: clientId },
    data: { lastReviewRequestSentAt: new Date() },
  });
}

function getApplicableRules(input: {
  context: AutomationContext;
  client: AutomationClient;
  triggerType?: string;
  ruleId?: string;
}) {
  return input.client.automationRules.filter((rule) => {
    if (input.ruleId && rule.id !== input.ruleId) return false;
    if (input.triggerType && rule.triggerType !== input.triggerType) return false;
    if (rule.jobType && rule.jobType !== input.context.jobType) return false;
    return true;
  });
}

async function dispatchSingleRule(input: {
  context: AutomationContext;
  client: AutomationClient;
  rule: AutomationRule;
  recipient: AutomationRecipient;
  cleaner: AutomationCleaner;
  jobId: string;
  now: number;
}) {
  const skipReason = getRuleSkipReason({
    rule: input.rule,
    context: input.context,
    client: input.client,
    now: input.now,
  });
  if (skipReason) {
    return { sent: 0, skipped: [`${input.rule.triggerType}:${skipReason}`] };
  }

  const payload = await buildAutomationPayload({
    context: input.context,
    client: input.client,
    recipient: input.recipient,
    cleaner: input.cleaner,
    rule: input.rule,
    jobId: input.jobId,
  });

  const result = await dispatchRuleChannels({
    rule: input.rule,
    recipient: input.recipient,
    jobId: input.jobId,
    subject: payload.subject,
    body: payload.body,
  });

  if (result.sent > 0) {
    await markReviewSentIfNeeded(input.rule, input.client.id);
  }

  return {
    sent: result.sent,
    skipped: result.skipped.map((reason) => `${input.rule.triggerType}:${reason}`),
  };
}

export async function queueClientPostJobAutomations(jobId: string, triggerType?: string) {
  const context = await getAutomationContext(jobId);
  if (!context?.property.client) return { queued: 0, skipped: ["missing_client"] as string[] };
  if (!DATABASE_URL) return { queued: 0, skipped: ["missing_database_url"] as string[] };

  const client = context.property.client;
  const rules = getApplicableRules({ context, client, triggerType });
  if (rules.length === 0) return { queued: 0, skipped: [] as string[] };

  const boss = new PgBoss(DATABASE_URL);
  await boss.start();
  try {
    for (const rule of rules) {
      const options =
        rule.delayMinutes > 0
          ? { startAfter: new Date(Date.now() + rule.delayMinutes * 60_000).toISOString() }
          : {};
      await boss.send("post-job-followup", { jobId, ruleId: rule.id }, options);
    }
  } finally {
    await boss.stop();
  }

  return { queued: rules.length, skipped: [] as string[] };
}

export async function dispatchClientPostJobAutomationRule(input: { jobId: string; ruleId: string }) {
  return dispatchClientPostJobAutomations(input.jobId, undefined, input.ruleId);
}

export async function dispatchClientPostJobAutomations(jobId: string, triggerType?: string, ruleId?: string) {
  const context = await getAutomationContext(jobId);
  if (!context?.property.client) return { sent: 0, skipped: ["missing_client"] as string[] };

  const client = context.property.client;
  const primaryCleaner = context.assignments.find((assignment) => assignment.isPrimary)?.user ?? context.assignments[0]?.user;
  const primaryRecipient = client.users[0];
  if (!primaryRecipient) return { sent: 0, skipped: ["missing_client_user"] as string[] };

  const rules = getApplicableRules({ context, client, triggerType, ruleId });
  const now = Date.now();
  let sent = 0;
  const skipped: string[] = [];

  for (const rule of rules) {
    const result = await dispatchSingleRule({
      context,
      client,
      rule,
      recipient: primaryRecipient,
      cleaner: primaryCleaner,
      jobId,
      now,
    });
    sent += result.sent;
    skipped.push(...result.skipped);
  }

  return { sent, skipped };
}
