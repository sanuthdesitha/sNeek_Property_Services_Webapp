import {
  JobStatus,
  MediaType,
  NotificationChannel,
  NotificationStatus,
  type JobTask,
} from "@prisma/client";
import { format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { publicUrl } from "@/lib/s3";
import { getAppSettings } from "@/lib/settings";
import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";
import { getJobReference } from "@/lib/jobs/job-number";
import { resolveAppUrl } from "@/lib/app-url";
import { applyReschedule } from "@/lib/phase4/analytics";

type RequestLike =
  | { url?: string; headers?: Headers | { get?: (name: string) => string | null } }
  | string
  | URL
  | null
  | undefined;

const FINISHED_JOB_STATUSES: JobStatus[] = [
  JobStatus.SUBMITTED,
  JobStatus.QA_REVIEW,
  JobStatus.COMPLETED,
  JobStatus.INVOICED,
];

function inferMediaTypeFromKey(key: string) {
  return /\.(mp4|mov|webm|m4v|avi)$/i.test(key) ? MediaType.VIDEO : MediaType.PHOTO;
}

function resolveScheduledAt(
  job: {
    scheduledDate: Date;
    startTime?: string | null;
    dueTime?: string | null;
    endTime?: string | null;
  },
  timezone: string
) {
  const localDate = toZonedTime(job.scheduledDate, timezone);
  const datePart = format(localDate, "yyyy-MM-dd");
  const timeValue = job.startTime || job.dueTime || job.endTime || "08:00";
  const safeTime = /^\d{2}:\d{2}$/.test(timeValue) ? timeValue : "08:00";
  return fromZonedTime(`${datePart}T${safeTime}:00`, timezone);
}

function createAutoApproveAt(job: {
  scheduledDate: Date;
  startTime?: string | null;
  dueTime?: string | null;
  endTime?: string | null;
}) {
  const timezone = "Australia/Sydney";
  const scheduledAt = resolveScheduledAt(job, timezone);
  return new Date(scheduledAt.getTime() - 60 * 60 * 1000);
}

async function getAdminRecipients() {
  return db.user.findMany({
    where: { role: { in: ["ADMIN", "OPS_MANAGER"] }, isActive: true },
    select: { id: true, role: true, name: true, email: true, phone: true },
  });
}

async function getAssignedCleanerRecipients(jobId: string) {
  return db.user.findMany({
    where: {
      isActive: true,
      role: "CLEANER",
      jobAssignments: {
        some: {
          jobId,
          removedAt: null,
        },
      },
    },
    select: { id: true, role: true, name: true, email: true, phone: true },
  });
}

async function buildNotificationContext(taskId: string) {
  const task = await db.jobTask.findUnique({
    where: { id: taskId },
    include: {
      job: {
        select: {
          id: true,
          jobNumber: true,
          jobType: true,
          scheduledDate: true,
          startTime: true,
          dueTime: true,
        },
      },
      property: { select: { name: true, suburb: true, clientId: true } },
      requestedBy: { select: { id: true, role: true, name: true, email: true, phone: true } },
    },
  });
  if (!task) return null;
  const when = task.job
    ? `${format(toZonedTime(task.job.scheduledDate, "Australia/Sydney"), "dd MMM yyyy")}${
        task.job.startTime ? ` ${task.job.startTime}` : task.job.dueTime ? ` ${task.job.dueTime}` : ""
      }`
    : "Upcoming service";
  return {
    task,
    propertyLabel: `${task.property.name}${task.property.suburb ? ` (${task.property.suburb})` : ""}`,
    jobReference: task.job ? getJobReference(task.job) : "Upcoming job",
    when,
  };
}

export async function syncAdminJobTasks(input: {
  jobId: string;
  propertyId: string;
  clientId?: string | null;
  actorUserId: string;
  tasks: Array<{
    id?: string | null;
    title: string;
    description?: string | null;
    requiresPhoto?: boolean;
    requiresNote?: boolean;
  }>;
}) {
  const existing = await db.jobTask.findMany({
    where: {
      jobId: input.jobId,
      source: "ADMIN",
      executionStatus: { not: "CANCELLED" },
    },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((row) => row.id));
  const nextIds = new Set<string>();

  for (const task of input.tasks) {
    const title = task.title.trim();
    if (!title) continue;
    const taskId = task.id && existingIds.has(task.id) ? task.id : null;
    if (taskId) {
      nextIds.add(taskId);
      await db.jobTask.update({
        where: { id: taskId },
        data: {
          title,
          description: task.description?.trim() || null,
          requiresPhoto: task.requiresPhoto === true,
          requiresNote: task.requiresNote === true,
          visibleToCleaner: true,
          approvalStatus: "APPROVED",
        },
      });
      continue;
    }

    const created = await db.jobTask.create({
      data: {
        jobId: input.jobId,
        propertyId: input.propertyId,
        clientId: input.clientId ?? null,
        source: "ADMIN",
        approvalStatus: "APPROVED",
        executionStatus: "OPEN",
        visibleToCleaner: true,
        title,
        description: task.description?.trim() || null,
        requiresPhoto: task.requiresPhoto === true,
        requiresNote: task.requiresNote === true,
        requestedByUserId: input.actorUserId,
        approvedByUserId: input.actorUserId,
        approvedAt: new Date(),
        events: {
          create: {
            actorUserId: input.actorUserId,
            action: "ADMIN_TASK_CREATED",
            note: "Admin created job task",
          },
        },
      },
      select: { id: true },
    });
    nextIds.add(created.id);
  }

  const toCancel = existing.filter((row) => !nextIds.has(row.id)).map((row) => row.id);
  if (toCancel.length > 0) {
    await db.jobTask.updateMany({
      where: { id: { in: toCancel } },
      data: {
        executionStatus: "CANCELLED",
        visibleToCleaner: false,
      },
    });
  }
}

export async function createClientJobTaskRequest(input: {
  jobId: string;
  clientId: string;
  requestedByUserId: string;
  title: string;
  description?: string | null;
  requiresPhoto?: boolean;
  requiresNote?: boolean;
  attachmentKeys?: string[];
  metadata?: Record<string, unknown> | null;
  baseUrl?: RequestLike;
}) {
  const job = await db.job.findUnique({
    where: { id: input.jobId },
    select: {
      id: true,
      jobNumber: true,
      scheduledDate: true,
      startTime: true,
      dueTime: true,
      propertyId: true,
      property: { select: { name: true, suburb: true, clientId: true } },
    },
  });
  if (!job || job.property.clientId !== input.clientId) {
    throw new Error("JOB_NOT_FOUND");
  }

  const created = await db.jobTask.create({
    data: {
      jobId: job.id,
      propertyId: job.propertyId,
      clientId: input.clientId,
      source: "CLIENT",
      approvalStatus: "PENDING_APPROVAL",
      executionStatus: "OPEN",
      visibleToCleaner: false,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      requiresPhoto: input.requiresPhoto === true,
      requiresNote: input.requiresNote === true,
      requestedByUserId: input.requestedByUserId,
      autoApproveAt: createAutoApproveAt(job),
      metadata: input.metadata != null ? (input.metadata as any) : undefined,
      attachments: {
        create: (input.attachmentKeys ?? [])
          .filter((key) => key.trim().length > 0)
          .map((key) => ({
            uploadedByUserId: input.requestedByUserId,
            mediaType: inferMediaTypeFromKey(key),
            kind: "REQUEST_REFERENCE",
            url: publicUrl(key),
            s3Key: key,
            label: "Client request reference",
          })),
      },
      events: {
        create: {
          actorUserId: input.requestedByUserId,
          action: "CLIENT_TASK_REQUESTED",
          note: input.description?.trim() || "Client requested a job task.",
        },
      },
    },
  });

  const admins = await getAdminRecipients();
  const jobReference = getJobReference(job);
  const propertyLabel = `${job.property.name}${job.property.suburb ? ` (${job.property.suburb})` : ""}`;
  const actionUrl = resolveAppUrl(`/admin/jobs/${job.id}`, input.baseUrl);

  await deliverNotificationToRecipients({
    recipients: admins,
    category: "approvals",
    jobId: job.id,
    web: {
      subject: "Client task approval required",
      body: `Client task request for ${jobReference} at ${propertyLabel} needs approval.`,
    },
    email: {
      subject: `Client task approval required - ${jobReference}`,
      html: `
        <p>A client task request needs approval.</p>
        <p><strong>Job:</strong> ${jobReference}</p>
        <p><strong>Property:</strong> ${propertyLabel}</p>
        <p><strong>Task:</strong> ${created.title}</p>
        <p><a href="${actionUrl}">Review job</a></p>
      `,
    },
    sms: `Approval needed: client task for ${jobReference} at ${propertyLabel}.`,
  });

  return created;
}

export async function reviewJobTaskRequest(input: {
  taskId: string;
  actorUserId: string;
  decision: "APPROVE" | "REJECT";
  note?: string | null;
  baseUrl?: RequestLike;
}) {
  const context = await buildNotificationContext(input.taskId);
  if (!context) throw new Error("TASK_NOT_FOUND");
  const { task } = context;
  if (task.source !== "CLIENT" || task.approvalStatus !== "PENDING_APPROVAL") {
    throw new Error("TASK_NOT_PENDING");
  }

  const approvalStatus = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
  const updated = await db.jobTask.update({
    where: { id: input.taskId },
    data: {
      approvalStatus,
      visibleToCleaner: input.decision === "APPROVE",
      approvedByUserId: input.actorUserId,
      approvedAt: new Date(),
      events: {
        create: {
          actorUserId: input.actorUserId,
          action: input.decision === "APPROVE" ? "CLIENT_TASK_APPROVED" : "CLIENT_TASK_REJECTED",
          note: input.note?.trim() || null,
        },
      },
    },
  });

  // If this is a reschedule request and it was approved, update the job date
  if (input.decision === "APPROVE" && task.jobId) {
    const meta = task.metadata as Record<string, unknown> | null;
    if (meta?.type === "RESCHEDULE_REQUEST" && typeof meta.requestedDate === "string") {
      try {
        await applyReschedule({
          jobId: task.jobId,
          date: meta.requestedDate,
          startTime: typeof meta.requestedStartTime === "string" ? meta.requestedStartTime : null,
          userId: input.actorUserId,
          reason: "Approved client reschedule request",
        });
      } catch {
        // Non-fatal: task was approved but reschedule failed (log to event)
        await db.jobTaskEvent.create({
          data: {
            taskId: task.id,
            actorUserId: input.actorUserId,
            action: "RESCHEDULE_APPLY_FAILED",
            note: "Task approved but job date update failed — please reschedule manually.",
          },
        });
      }
    }
  }

  const recipients = [];
  if (task.requestedBy) recipients.push(task.requestedBy);
  if (task.jobId && input.decision === "APPROVE") {
    recipients.push(...(await getAssignedCleanerRecipients(task.jobId)));
  }

  if (recipients.length > 0) {
    const actionUrl = resolveAppUrl(
      input.decision === "APPROVE" && task.jobId ? `/cleaner/jobs/${task.jobId}` : "/client/jobs",
      input.baseUrl
    );
    await deliverNotificationToRecipients({
      recipients,
      category: input.decision === "APPROVE" ? "jobs" : "approvals",
      jobId: task.jobId ?? null,
      web: {
        subject: input.decision === "APPROVE" ? "Job task approved" : "Job task request declined",
        body:
          input.decision === "APPROVE"
            ? `${task.title} was approved for ${context.jobReference}.`
            : `${task.title} was declined for ${context.jobReference}.`,
      },
      email: {
        subject:
          input.decision === "APPROVE"
            ? `Job task approved - ${context.jobReference}`
            : `Job task request declined - ${context.jobReference}`,
        html: `
          <p>${input.decision === "APPROVE" ? "A job task was approved." : "A job task request was declined."}</p>
          <p><strong>Task:</strong> ${task.title}</p>
          <p><strong>Job:</strong> ${context.jobReference}</p>
          <p><strong>Property:</strong> ${context.propertyLabel}</p>
          ${input.note?.trim() ? `<p><strong>Note:</strong> ${input.note.trim()}</p>` : ""}
          <p><a href="${actionUrl}">Open</a></p>
        `,
      },
      sms:
        input.decision === "APPROVE"
          ? `Approved: ${task.title} for ${context.jobReference}.`
          : `Declined: ${task.title} for ${context.jobReference}.`,
    });
  }

  return updated;
}

export async function autoApprovePendingClientJobTasks(now = new Date(), baseUrl?: RequestLike) {
  const pending = await db.jobTask.findMany({
    where: {
      source: "CLIENT",
      approvalStatus: "PENDING_APPROVAL",
      autoApproveAt: { lte: now },
    },
    select: { id: true },
    take: 200,
  });

  let approvedCount = 0;
  for (const task of pending) {
    const context = await buildNotificationContext(task.id);
    if (!context) continue;
    const updated = await db.jobTask.update({
      where: { id: task.id },
      data: {
        approvalStatus: "AUTO_APPROVED",
        visibleToCleaner: true,
        approvedAt: now,
        events: {
          create: {
            action: "CLIENT_TASK_AUTO_APPROVED",
            note: "Automatically approved because no admin decision was made before the job started.",
          },
        },
      },
    });
    approvedCount += 1;

    const admins = await getAdminRecipients();
    const cleaners = context.task.jobId ? await getAssignedCleanerRecipients(context.task.jobId) : [];
    const recipients = [
      ...admins,
      ...cleaners,
      ...(context.task.requestedBy ? [context.task.requestedBy] : []),
    ];

    await deliverNotificationToRecipients({
      recipients,
      category: "approvals",
      jobId: context.task.jobId ?? null,
      web: {
        subject: "Job task auto-approved",
        body: `${context.task.title} was auto-approved for ${context.jobReference}.`,
      },
      email: {
        subject: `Job task auto-approved - ${context.jobReference}`,
        html: `
          <p>A client job task was auto-approved because no admin decision was made before the deadline.</p>
          <p><strong>Task:</strong> ${updated.title}</p>
          <p><strong>Job:</strong> ${context.jobReference}</p>
          <p><strong>Property:</strong> ${context.propertyLabel}</p>
        `,
      },
      sms: `Auto-approved: ${updated.title} for ${context.jobReference}.`,
    });
  }

  return { approvedCount };
}

export async function listCleanerJobTasks(jobId: string) {
  return db.jobTask.findMany({
    where: {
      jobId,
      visibleToCleaner: true,
      approvalStatus: { in: ["APPROVED", "AUTO_APPROVED"] },
      executionStatus: "OPEN",
    },
    include: {
      attachments: {
        where: { kind: "REQUEST_REFERENCE" },
        orderBy: { createdAt: "asc" },
      },
      parentTask: {
        select: {
          id: true,
          title: true,
          source: true,
        },
      },
    },
    orderBy: [{ source: "asc" }, { createdAt: "asc" }],
  });
}

export async function listClientJobTasks(jobId: string, clientId: string) {
  return db.jobTask.findMany({
    where: {
      jobId,
      clientId,
    },
    include: {
      attachments: {
        where: { kind: "REQUEST_REFERENCE" },
        orderBy: { createdAt: "asc" },
      },
      events: {
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function attachPendingCarryForwardTasksToJob(input: {
  jobId: string;
  propertyId: string;
  scheduledDate: Date;
  startTime?: string | null;
}) {
  const targetJob = await db.job.findFirst({
    where: {
      propertyId: input.propertyId,
      status: { notIn: FINISHED_JOB_STATUSES },
    },
    select: {
      id: true,
      scheduledDate: true,
      startTime: true,
    },
    orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
  });

  if (!targetJob || targetJob.id !== input.jobId) return { attached: 0 };

  const result = await db.jobTask.updateMany({
    where: {
      propertyId: input.propertyId,
      source: "CARRY_FORWARD",
      jobId: null,
      executionStatus: "OPEN",
    },
    data: {
      jobId: input.jobId,
      visibleToCleaner: true,
    },
  });

  return { attached: result.count };
}

/**
 * Attach admin-created pending tasks (source=ADMIN, jobId=null) to a specific job.
 * Called when a new job is created or assigned so admin tasks queued for a property
 * automatically appear on the cleaner's task list.
 */
export async function attachPendingAdminTasksToJob(input: {
  jobId: string;
  propertyId: string;
}): Promise<{ attached: number }> {
  const result = await db.jobTask.updateMany({
    where: {
      propertyId: input.propertyId,
      source: "ADMIN",
      jobId: null,
      approvalStatus: "AUTO_APPROVED",
      executionStatus: "OPEN",
    },
    data: {
      jobId: input.jobId,
      visibleToCleaner: true,
    },
  });
  return { attached: result.count };
}

export async function applyCleanerJobTaskUpdates(input: {
  jobId: string;
  propertyId: string;
  clientId?: string | null;
  cleanerId: string;
  taskUpdates: Array<{
    id: string;
    decision: "COMPLETED" | "NOT_COMPLETED";
    note?: string;
    proofKeys?: string[];
  }>;
  baseUrl?: RequestLike;
}) {
  const job = await db.job.findUnique({
    where: { id: input.jobId },
    select: {
      id: true,
      jobNumber: true,
      scheduledDate: true,
      startTime: true,
      dueTime: true,
      property: { select: { name: true, suburb: true, clientId: true } },
    },
  });
  if (!job) throw new Error("JOB_NOT_FOUND");

  let carriedForwardCount = 0;
  for (const update of input.taskUpdates) {
    const existing = await db.jobTask.findUnique({
      where: { id: update.id },
      include: { attachments: true },
    });
    if (!existing || existing.jobId !== input.jobId) continue;

    const note = update.note?.trim() || null;
    const proofKeys = (update.proofKeys ?? []).filter((key) => key.trim().length > 0);

    await db.jobTask.update({
      where: { id: update.id },
      data: {
        executionStatus: update.decision,
        completedAt: new Date(),
        events: {
          create: {
            actorUserId: input.cleanerId,
            action: update.decision === "COMPLETED" ? "TASK_COMPLETED" : "TASK_NOT_COMPLETED",
            note,
            metadata: {
              proofCount: proofKeys.length,
            },
          },
        },
      },
    });

    if (proofKeys.length > 0) {
      await db.jobTaskAttachment.createMany({
        data: proofKeys.map((key) => ({
          taskId: update.id,
          uploadedByUserId: input.cleanerId,
          mediaType: inferMediaTypeFromKey(key),
          kind: update.decision === "COMPLETED" ? "COMPLETION_PROOF" : "FAILURE_PROOF",
          url: publicUrl(key),
          s3Key: key,
          label: update.decision === "COMPLETED" ? "Completion proof" : "Not completed proof",
        })),
      });
    }

    if (update.decision === "NOT_COMPLETED") {
      const nextJob = await db.job.findFirst({
        where: {
          propertyId: input.propertyId,
          status: { notIn: FINISHED_JOB_STATUSES },
          scheduledDate: { gte: job.scheduledDate },
          id: { not: input.jobId },
        },
        select: { id: true },
        orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
      });

      await db.jobTask.create({
        data: {
          jobId: nextJob?.id ?? null,
          propertyId: input.propertyId,
          clientId: input.clientId ?? null,
          source: "CARRY_FORWARD",
          approvalStatus: "APPROVED",
          executionStatus: "OPEN",
          visibleToCleaner: Boolean(nextJob?.id),
          title: existing.title,
          description: existing.description,
          requiresPhoto: existing.requiresPhoto,
          requiresNote: existing.requiresNote,
          requestedByUserId: input.cleanerId,
          approvedByUserId: input.cleanerId,
          approvedAt: new Date(),
          parentTaskId: existing.id,
          events: {
            create: {
              actorUserId: input.cleanerId,
              action: "TASK_CARRIED_FORWARD",
              note: note || "Task carried forward to the next clean.",
            },
          },
        },
      });
      carriedForwardCount += 1;

      const admins = await getAdminRecipients();
      const propertyLabel = `${job.property.name}${job.property.suburb ? ` (${job.property.suburb})` : ""}`;
      const jobReference = getJobReference(job);
      const actionUrl = resolveAppUrl(`/admin/jobs/${input.jobId}`, input.baseUrl);
      await deliverNotificationToRecipients({
        recipients: admins,
        category: "jobs",
        jobId: input.jobId,
        web: {
          subject: "Job task not completed",
          body: `${existing.title} was marked not completed for ${jobReference}.`,
        },
        email: {
          subject: `Job task not completed - ${jobReference}`,
          html: `
            <p>A cleaner marked a job task as not completed.</p>
            <p><strong>Task:</strong> ${existing.title}</p>
            <p><strong>Job:</strong> ${jobReference}</p>
            <p><strong>Property:</strong> ${propertyLabel}</p>
            ${note ? `<p><strong>Reason:</strong> ${note}</p>` : ""}
            <p><a href="${actionUrl}">Review job</a></p>
          `,
        },
        sms: `Not completed: ${existing.title} on ${jobReference}.`,
      });
    }
  }

  return { carriedForwardCount };
}
