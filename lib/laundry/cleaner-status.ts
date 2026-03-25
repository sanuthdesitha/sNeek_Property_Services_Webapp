import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { LaundryStatus, NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { publicUrl } from "@/lib/s3";
import { ensureLaundryTaskForJob } from "@/lib/laundry/planner";
import { getAppSettings } from "@/lib/settings";
import { renderEmailTemplate } from "@/lib/email-templates";
import { renderNotificationTemplate } from "@/lib/notification-templates";
import { getJobReference } from "@/lib/jobs/job-number";
import { getAssignedLaundryUsersForProperty } from "@/lib/laundry/teams";
import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";

export type CleanerLaundryOutcome = "READY_FOR_PICKUP" | "NOT_READY" | "NO_PICKUP_REQUIRED";
export type CleanerLaundryUpdateSource = "EARLY_UPDATE" | "FINAL_SUBMISSION";

function buildCleanerConfirmationNotes(params: {
  source: CleanerLaundryUpdateSource;
  laundryOutcome: CleanerLaundryOutcome;
  reasonCode?: string | null;
  reasonNote?: string | null;
}) {
  return JSON.stringify({
    source: params.source,
    laundryOutcome: params.laundryOutcome,
    reasonCode: params.reasonCode ?? null,
    reasonNote: params.reasonNote ?? null,
  });
}

async function notifyLaundryPartners(params: {
  propertyId: string;
  propertyName: string;
  jobId: string;
  jobNumber: string;
  cleanDate: Date;
  pickupDate: Date;
  bagLocation: string;
  laundryPhotoUrl: string;
  portalUrl: string;
}) {
  const settings = await getAppSettings();
  const laundryUsers = await getAssignedLaundryUsersForProperty(params.propertyId);
  const cleanDateLabel = format(
    toZonedTime(params.cleanDate, settings.timezone || "Australia/Sydney"),
    "EEEE, dd MMMM yyyy"
  );
  const pickupDateLabel = format(
    toZonedTime(params.pickupDate, settings.timezone || "Australia/Sydney"),
    "EEEE, dd MMMM yyyy"
  );
  const emailTemplate = renderEmailTemplate(settings, "laundryReady", {
    propertyName: params.propertyName,
    jobNumber: params.jobNumber,
    cleanDate: cleanDateLabel,
    scheduledPickupDate: pickupDateLabel,
    bagLocation: params.bagLocation,
    laundryPhotoUrl: params.laundryPhotoUrl,
    portalUrl: params.portalUrl,
    actionUrl: params.portalUrl,
    actionLabel: "Open laundry portal",
  });
  const notificationTemplate = renderNotificationTemplate(settings, "laundryReady", {
    jobNumber: params.jobNumber,
    propertyName: params.propertyName,
    cleanDate: cleanDateLabel,
    scheduledPickupDate: pickupDateLabel,
    bagLocation: params.bagLocation,
  });

  await deliverNotificationToRecipients({
    recipients: laundryUsers,
    category: "laundry",
    jobId: params.jobId,
    web: {
      subject: notificationTemplate.webSubject,
      body: notificationTemplate.webBody,
    },
    email: {
      subject: emailTemplate.subject,
      html: emailTemplate.html,
      logBody: notificationTemplate.webBody,
    },
    sms: notificationTemplate.smsBody,
  });
}

async function alertAdminsLaundryNotReady(jobId: string, propertyName: string, jobNumber: string) {
  const adminUsers = await db.user.findMany({
    where: { role: Role.ADMIN, isActive: true },
    select: { id: true },
  });

  for (const admin of adminUsers) {
    await db.notification.create({
      data: {
        userId: admin.id,
        jobId,
        channel: NotificationChannel.EMAIL,
        subject: `Laundry not ready - ${jobNumber}`,
        body: `${jobNumber}: Cleaner submitted job for ${propertyName} with laundry_ready=NO. Laundry partner was not notified.`,
        status: NotificationStatus.PENDING,
      },
    });
  }
}

async function notifyLaundrySkipRequested(params: {
  propertyId: string;
  jobId: string;
  propertyName: string;
  jobNumber: string;
  cleanDate: Date;
  laundryOutcome: "NOT_READY" | "NO_PICKUP_REQUIRED";
  reasonCode: string;
  reasonNote: string;
  portalUrl: string;
}) {
  const settings = await getAppSettings();
  const laundryUsers = await getAssignedLaundryUsersForProperty(params.propertyId);
  const cleanDateLabel = format(
    toZonedTime(params.cleanDate, settings.timezone || "Australia/Sydney"),
    "EEEE, dd MMMM yyyy"
  );
  const template = renderEmailTemplate(settings, "laundrySkipRequested", {
    propertyName: params.propertyName,
    jobNumber: params.jobNumber,
    cleanDate: cleanDateLabel,
    laundryOutcome: params.laundryOutcome.replace(/_/g, " "),
    reasonCode: params.reasonCode.replace(/_/g, " "),
    reasonNote: params.reasonNote,
    actionUrl: params.portalUrl,
    actionLabel: "Open laundry portal",
  });
  const notificationTemplate = renderNotificationTemplate(settings, "laundrySkipRequested", {
    jobNumber: params.jobNumber,
    propertyName: params.propertyName,
    cleanDate: cleanDateLabel,
    laundryOutcome: params.laundryOutcome.replace(/_/g, " "),
    reasonCode: params.reasonCode.replace(/_/g, " "),
    reasonNote: params.reasonNote ? ` - ${params.reasonNote}` : "",
  });

  await deliverNotificationToRecipients({
    recipients: laundryUsers,
    category: "laundry",
    jobId: params.jobId,
    web: {
      subject: notificationTemplate.webSubject,
      body: notificationTemplate.webBody,
    },
    email: {
      subject: template.subject,
      html: template.html,
      logBody: notificationTemplate.webBody,
    },
    sms: notificationTemplate.smsBody,
  });
}

export async function applyCleanerLaundryStatusUpdate(params: {
  jobId: string;
  cleanerId: string;
  laundryOutcome: CleanerLaundryOutcome;
  bagLocation?: string | null;
  laundryPhotoKey?: string | null;
  laundrySkipReasonCode?: string | null;
  laundrySkipReasonNote?: string | null;
  source: CleanerLaundryUpdateSource;
  portalUrl: string;
}) {
  const job = await db.job.findUnique({
    where: { id: params.jobId },
    include: {
      property: true,
      laundryTask: {
        include: {
          confirmations: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });
  if (!job) {
    throw new Error("Job not found");
  }

  let laundryTask = job.laundryTask;
  if (!laundryTask) {
    const ensuredLaundryTask = await ensureLaundryTaskForJob(job.id);
    laundryTask = ensuredLaundryTask
      ? await db.laundryTask.findUnique({
          where: { id: ensuredLaundryTask.id },
          include: {
            confirmations: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        })
      : null;
  }
  if (!laundryTask) {
    const pickupDate = new Date(job.scheduledDate.getTime() + 24 * 60 * 60 * 1000);
    const dropoffDate = new Date(job.scheduledDate.getTime() + 48 * 60 * 60 * 1000);
    laundryTask = await db.laundryTask.create({
      data: {
        jobId: job.id,
        propertyId: job.propertyId,
        pickupDate,
        dropoffDate,
        status: LaundryStatus.PENDING,
      },
      include: {
        confirmations: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
  }

  const latestConfirmation = laundryTask.confirmations?.[0] ?? null;
  const jobNumber = getJobReference(job);

  if (params.laundryOutcome === "READY_FOR_PICKUP") {
    const laundryPhotoUrl = publicUrl(params.laundryPhotoKey!);
    const isDuplicate =
      laundryTask.status === LaundryStatus.CONFIRMED &&
      laundryTask.notifyLaundry === true &&
      laundryTask.noPickupRequired === false &&
      latestConfirmation?.laundryReady === true &&
      latestConfirmation?.bagLocation === (params.bagLocation ?? null) &&
      latestConfirmation?.photoUrl === laundryPhotoUrl;

    if (isDuplicate) {
      return { ok: true, duplicated: true, laundryTask };
    }

    const updatedTask = await db.$transaction(async (tx) => {
      const nextTask = await tx.laundryTask.update({
        where: { id: laundryTask.id },
        include: {
          confirmations: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        data: {
          status: LaundryStatus.CONFIRMED,
          notifyLaundry: true,
          noPickupRequired: false,
          skipReasonCode: null,
          skipReasonNote: null,
          adminOverrideNote: null,
          adminOverrideById: null,
          adminOverrideAt: null,
          confirmedAt: new Date(),
        },
      });

      await tx.laundryConfirmation.create({
        data: {
          laundryTaskId: laundryTask.id,
          confirmedById: params.cleanerId,
          laundryReady: true,
          bagLocation: params.bagLocation ?? null,
          photoUrl: laundryPhotoUrl,
          notes: buildCleanerConfirmationNotes({
            source: params.source,
            laundryOutcome: params.laundryOutcome,
          }),
        },
      });

      return nextTask;
    });

    await notifyLaundryPartners({
      propertyId: job.propertyId,
      propertyName: job.property.name,
      jobId: job.id,
      jobNumber,
      cleanDate: job.scheduledDate,
      pickupDate: laundryTask.pickupDate,
      bagLocation: params.bagLocation ?? "",
      laundryPhotoUrl,
      portalUrl: params.portalUrl,
    });

    return { ok: true, duplicated: false, laundryTask: updatedTask };
  }

  const noPickupRequired = params.laundryOutcome === "NO_PICKUP_REQUIRED";
  const nextStatus = noPickupRequired ? LaundryStatus.SKIPPED_PICKUP : LaundryStatus.FLAGGED;
  const isDuplicate =
    laundryTask.status === nextStatus &&
    laundryTask.noPickupRequired === noPickupRequired &&
    (laundryTask.skipReasonCode ?? null) === (params.laundrySkipReasonCode ?? null) &&
    (laundryTask.skipReasonNote ?? null) === (params.laundrySkipReasonNote ?? null);

  if (isDuplicate) {
    return { ok: true, duplicated: true, laundryTask };
  }

  const updatedTask = await db.$transaction(async (tx) => {
    const nextTask = await tx.laundryTask.update({
      where: { id: laundryTask.id },
      include: {
        confirmations: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      data: {
        notifyLaundry: false,
        status: nextStatus,
        noPickupRequired,
        skipReasonCode: params.laundrySkipReasonCode || null,
        skipReasonNote: params.laundrySkipReasonNote || null,
      },
    });

    await tx.laundryConfirmation.create({
      data: {
        laundryTaskId: laundryTask.id,
        confirmedById: params.cleanerId,
        laundryReady: false,
        bagLocation: params.bagLocation ?? null,
        notes: buildCleanerConfirmationNotes({
          source: params.source,
          laundryOutcome: params.laundryOutcome,
          reasonCode: params.laundrySkipReasonCode,
          reasonNote: params.laundrySkipReasonNote,
        }),
      },
    });

    return nextTask;
  });

  await Promise.all([
    alertAdminsLaundryNotReady(job.id, job.property.name, jobNumber),
    notifyLaundrySkipRequested({
      propertyId: job.propertyId,
      jobId: job.id,
      propertyName: job.property.name,
      jobNumber,
      cleanDate: job.scheduledDate,
      laundryOutcome: params.laundryOutcome,
      reasonCode: params.laundrySkipReasonCode || "OTHER",
      reasonNote: params.laundrySkipReasonNote || "",
      portalUrl: params.portalUrl,
    }),
  ]);

  return { ok: true, duplicated: false, laundryTask: updatedTask };
}
