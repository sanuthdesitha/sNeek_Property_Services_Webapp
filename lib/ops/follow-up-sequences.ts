import PgBoss from "pg-boss";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { buildRatingToken } from "@/lib/client/ratings";
import { resolveAppUrl } from "@/lib/app-url";
import { getAppSettings } from "@/lib/settings";
import { loadNotificationWording, type WordingRenderer } from "@/lib/notifications/wording/render";

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

/** The follow-up email of a step, from the editable wording (catalog type client.post_job). */
function buildStepContent(step: FollowUpStep, job: JobContext, recipientName: string, wording: WordingRenderer) {
  const values = {
    clientName: recipientName || job.property.client?.name || "there",
    service: job.jobType.replace(/_/g, " ").toLowerCase(),
    propertyName: `${job.property.name}${job.property.suburb ? `, ${job.property.suburb}` : ""}`,
    propertyShort: job.property.name,
    cleanDate: job.scheduledDate.toISOString().slice(0, 10),
    jobNumber: job.jobNumber || job.id.slice(-6),
  };
  if (step === "1d") return wording.render("follow-up-1d", "EMAIL", values);
  if (step === "3d") {
    const token = buildRatingToken(job.id, job.property.client?.id || "");
    return wording.render("follow-up-3d", "EMAIL", { ...values, ratingUrl: resolveAppUrl(`/rate/${job.id}?token=${encodeURIComponent(token)}`) });
  }
  return wording.render("follow-up-rebook", "EMAIL", { ...values, quoteUrl: resolveAppUrl("/quote") });
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

  const content = buildStepContent(step, job, recipient.name, await loadNotificationWording("client.post_job"));
  const result = await sendEmailDetailed({ kind: "follow_up",
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
