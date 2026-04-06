import PgBoss from "pg-boss";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { buildRatingToken } from "@/lib/client/ratings";
import { resolveAppUrl } from "@/lib/app-url";
import { getAppSettings } from "@/lib/settings";

const DATABASE_URL = process.env.DATABASE_URL?.trim() || "";

type FollowUpStep = "1d" | "3d" | "14d";

type JobContext = {
  id: string;
  jobNumber: string | null;
  jobType: string;
  scheduledDate: Date;
  property: {
    name: string;
    suburb: string;
    clientId: string | null;
    client: {
      id: string;
      name: string;
      email: string | null;
      users: Array<{ email: string; name: string | null; isActive: boolean }>;
    } | null;
  };
  satisfactionRating: { id: string } | null;
};

async function getJobContext(jobId: string): Promise<JobContext | null> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      jobNumber: true,
      jobType: true,
      scheduledDate: true,
      satisfactionRating: { select: { id: true } },
      property: {
        select: {
          name: true,
          suburb: true,
          clientId: true,
          client: {
            select: {
              id: true,
              name: true,
              email: true,
              users: {
                where: { isActive: true },
                select: { email: true, name: true, isActive: true },
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      },
    },
  });
  return job as JobContext | null;
}

function getRecipient(job: JobContext) {
  const primaryUser = job.property.client?.users.find((user) => !!user.email?.trim());
  const email = primaryUser?.email?.trim() || job.property.client?.email?.trim() || "";
  if (!email) return null;
  return {
    email,
    name:
      primaryUser?.name?.trim() ||
      job.property.client?.name?.trim() ||
      email.split("@")[0] ||
      "Client",
  };
}

function buildStepContent(step: FollowUpStep, job: JobContext, recipientName: string) {
  const propertyLabel = `${job.property.name}${job.property.suburb ? `, ${job.property.suburb}` : ""}`;
  const cleanDate = job.scheduledDate.toISOString().slice(0, 10);
  const serviceLabel = job.jobType.replace(/_/g, " ").toLowerCase();
  const clientName = recipientName || job.property.client?.name || "there";
  if (step === "1d") {
    return {
      subject: `Thank you for choosing sNeek - ${job.jobNumber || job.id.slice(-6)}`,
      html: `
        <h2 style="margin:0 0 12px;">Thanks for booking with sNeek</h2>
        <p>Hello ${clientName},</p>
        <p>Thank you for trusting us with your ${serviceLabel} at <strong>${propertyLabel}</strong>.</p>
        <p>Your service dated <strong>${cleanDate}</strong> has been completed and recorded in the system.</p>
        <p>If you need anything further, just reply to this email and our team will take care of it.</p>
      `,
    };
  }

  if (step === "3d") {
    const token = buildRatingToken(job.id, job.property.client?.id || "");
    const ratingUrl = resolveAppUrl(`/rate/${job.id}?token=${encodeURIComponent(token)}`);
    return {
      subject: `How was your clean at ${job.property.name}?`,
      html: `
        <h2 style="margin:0 0 12px;">How did we do?</h2>
        <p>Hello ${clientName},</p>
        <p>We would appreciate a quick rating for your recent ${serviceLabel} at <strong>${propertyLabel}</strong>.</p>
        <p>Your feedback helps us keep quality high and improve follow-up when anything needs attention.</p>
        <p><a href="${ratingUrl}" target="_blank" rel="noopener noreferrer">Rate your clean now</a></p>
      `,
    };
  }

  const quoteUrl = resolveAppUrl("/quote");
  return {
    subject: `Ready for your next service at ${job.property.name}?`,
    html: `
      <h2 style="margin:0 0 12px;">Need another clean booked?</h2>
      <p>Hello ${clientName},</p>
      <p>If you would like to line up the next service for <strong>${propertyLabel}</strong>, we can arrange it now.</p>
      <p>Use the link below to request a new quote or booking and we will take care of the rest.</p>
      <p><a href="${quoteUrl}" target="_blank" rel="noopener noreferrer">Request your next clean</a></p>
    `,
  };
}

export async function scheduleJobFollowUps(jobId: string) {
  if (!DATABASE_URL) {
    return { scheduled: false, reason: "missing_database_url" as const };
  }

  const job = await getJobContext(jobId);
  if (!job?.id || !job.property.client?.id) {
    return { scheduled: false, reason: "missing_job_or_client" as const };
  }

  const boss = new PgBoss(DATABASE_URL);
  await boss.start();
  try {
    const base = new Date();
    const oneDay = new Date(base.getTime() + 24 * 60 * 60 * 1000);
    const threeDays = new Date(base.getTime() + 3 * 24 * 60 * 60 * 1000);
    const fourteenDays = new Date(base.getTime() + 14 * 24 * 60 * 60 * 1000);
    await boss.send("follow-up-1d", { jobId }, { startAfter: oneDay.toISOString() });
    await boss.send("follow-up-3d", { jobId }, { startAfter: threeDays.toISOString() });
    await boss.send("follow-up-14d", { jobId }, { startAfter: fourteenDays.toISOString() });
    return { scheduled: true };
  } finally {
    await boss.stop();
  }
}

export async function dispatchJobFollowUp(jobId: string, step: FollowUpStep) {
  const [job, settings] = await Promise.all([getJobContext(jobId), getAppSettings()]);
  if (!job?.id) return { sent: false, reason: "job_not_found" as const };
  if (step === "3d" && job.satisfactionRating?.id) {
    return { sent: false, reason: "already_rated" as const };
  }

  const recipient = getRecipient(job);
  if (!recipient) return { sent: false, reason: "missing_recipient" as const };

  const content = buildStepContent(step, job, recipient.name);
  const result = await sendEmailDetailed({
    to: recipient.email,
    subject: content.subject,
    html: content.html,
    replyTo: settings.accountsEmail || undefined,
  });

  if (!result.ok) {
    logger.error({ jobId, step, recipient: recipient.email, error: result.error }, "Follow-up email failed");
    return { sent: false, reason: "send_failed" as const, error: result.error };
  }

  return { sent: true };
}
