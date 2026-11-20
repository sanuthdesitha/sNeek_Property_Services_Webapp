import "server-only";
/**
 * Device notices (2026-11-20), both on the notification intent pipeline with
 * explicit transports ["INBOX"]: never email, SMS or device push. Queued is
 * not delivered.
 *
 * - property.device_charge_task: the cleaners on the clean that carries a
 *   charge task. Claimed once per task, clean and cleaner, so a retry, the
 *   hourly check or a second worker never sends it twice, and a cleaner
 *   assigned later still hears about it once.
 * - property.device_provider_failing: active administrators, once per outage
 *   (the caller claims DeviceProviderConnection.failureNoticeAt first).
 */
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getJobReference } from "@/lib/jobs/job-number";
import { dispatchNotificationOnce } from "@/lib/notifications/dispatch-once";
import { sendOfficeNotification, type OfficeRecipient } from "@/lib/notifications/office-sends";
import { getNotificationTypeControls } from "@/lib/notifications/type-controls";
import { loadNotificationWording } from "@/lib/notifications/wording/render";
import { holdsRoleWhere } from "@/lib/auth/role-query";
import { PROVIDER_LABEL, type ConnectedProvider } from "./types";

export const DEVICE_CHARGE_TASK_TYPE = "property.device_charge_task";
export const DEVICE_PROVIDER_FAILING_TYPE = "property.device_provider_failing";
export const DEVICE_NOTICE_TRANSPORTS = ["INBOX"] as const;
export const DEVICE_SETTINGS_URL = "/v2/admin/settings?tab=property-devices";

/** Tell the cleaners on the clean about an open charge task. Returns how many cleaners were newly told. */
export async function notifyDeviceChargeTask(taskId: string): Promise<number> {
  const task = await db.jobTask.findUnique({
    where: { id: taskId },
    select: {
      id: true, title: true, executionStatus: true, jobId: true,
      job: { select: { id: true, jobNumber: true, scheduledDate: true, status: true, property: { select: { name: true } } } },
    },
  });
  if (!task?.job || task.executionStatus !== "OPEN") return 0;
  const job = task.job;
  const recipients: OfficeRecipient[] = await db.user.findMany({
    where: { isActive: true, ...holdsRoleWhere("CLEANER"), jobAssignments: { some: { jobId: job.id, removedAt: null } } },
    select: { id: true, role: true, name: true, email: true },
  });
  if (recipients.length === 0) return 0;
  const wording = await loadNotificationWording(DEVICE_CHARGE_TASK_TYPE);
  const controls = await getNotificationTypeControls();
  const inbox = wording.render("task", "INBOX", {
    taskTitle: task.title,
    propertyName: job.property.name,
    jobNumber: getJobReference(job),
    jobDay: job.scheduledDate.toISOString().slice(0, 10),
  });
  let told = 0;
  for (const recipient of recipients) {
    const claimed = await dispatchNotificationOnce({ event: `device-charge:${task.id}`, day: "task", recipientId: recipient.id, jobId: job.id }, async () => {
      await sendOfficeNotification({
        typeKey: DEVICE_CHARGE_TASK_TYPE,
        eventKey: DEVICE_CHARGE_TASK_TYPE,
        eventId: `device-charge:${task.id}:${job.id}:${recipient.id}`,
        entity: { type: "JobTask", id: task.id },
        actorId: null,
        scopeType: "JOB_ASSIGNED_CLEANER",
        scopeId: () => job.id,
        category: "jobs",
        severity: "ACTION",
        jobId: job.id,
        subject: inbox.title,
        body: inbox.body,
        url: `/v2/cleaner/jobs/${job.id}`,
        transports: [...DEVICE_NOTICE_TRANSPORTS],
        recipients: [recipient],
        respectsPreferences: false,
        disabledTransports: controls.disabledTransports[DEVICE_CHARGE_TASK_TYPE] ?? [],
      });
    });
    if (claimed) told += 1;
  }
  return told;
}

export type ProviderFailingNoticeInput = {
  provider: ConnectedProvider;
  connectionId: string;
  reason: string;
  lastSuccessAt: Date | null;
  outageStartedAt: Date;
  timeZone: string;
};

/** Tell administrators once that a provider connection is not working. */
export async function sendProviderFailingNotice(input: ProviderFailingNoticeInput): Promise<void> {
  const recipients: OfficeRecipient[] = await db.user.findMany({ where: { isActive: true, role: Role.ADMIN }, select: { id: true, role: true, name: true, email: true } });
  if (recipients.length === 0) return;
  const wording = await loadNotificationWording(DEVICE_PROVIDER_FAILING_TYPE);
  const controls = await getNotificationTypeControls();
  const lastSuccess = input.lastSuccessAt
    ? new Intl.DateTimeFormat("en-AU", { timeZone: input.timeZone, dateStyle: "medium", timeStyle: "short" }).format(input.lastSuccessAt)
    : "never";
  const inbox = wording.render("failing", "INBOX", { providerName: PROVIDER_LABEL[input.provider], reason: input.reason, lastSuccess });
  await sendOfficeNotification({
    typeKey: DEVICE_PROVIDER_FAILING_TYPE,
    eventKey: DEVICE_PROVIDER_FAILING_TYPE,
    eventId: `device-provider-failing:${input.connectionId}:${input.outageStartedAt.toISOString()}`,
    entity: { type: "DeviceProviderConnection", id: input.connectionId },
    actorId: null,
    scopeType: "STAFF_MEMBER",
    scopeId: (recipient) => recipient.id,
    category: "jobs",
    severity: "ACTION",
    jobId: null,
    subject: inbox.title,
    body: inbox.body,
    url: DEVICE_SETTINGS_URL,
    transports: [...DEVICE_NOTICE_TRANSPORTS],
    recipients,
    respectsPreferences: false,
    disabledTransports: controls.disabledTransports[DEVICE_PROVIDER_FAILING_TYPE] ?? [],
  });
}
