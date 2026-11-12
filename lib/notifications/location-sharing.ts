import "server-only";
/**
 * Live-location notices through the notification intent pipeline
 * (lib/notifications/office-sends), with explicitly chosen transports:
 *
 * - `location.sharing` — "your location is being shared" / "stopped", INBOX
 *   only (never an email, SMS or device push), to the person themself:
 *   a cleaner through JOB_ASSIGNED_CLEANER, a driver through STAFF_MEMBER.
 * - `job.left_site_clock_out` — the automatic GPS clock-out: the cleaner and
 *   the office (ADMIN, and OPS_MANAGER with the Jobs pack, scope JOB_OFFICE),
 *   inbox plus phone/browser push. Queued is not delivered: callers keep the
 *   outcomes, they never claim delivery.
 *
 * Event ids are stable per occurrence (time log, route), so a retried request
 * is one pipeline event.
 */
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { sendOfficeNotification, type OfficeRecipient, type RecipientOutcome } from "./office-sends";
import { getNotificationTypeControls, typeRespectsPreferences } from "./type-controls";
import { loadNotificationWording } from "./wording/render";

type Person = OfficeRecipient;

async function person(userId: string): Promise<Person | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, role: true, name: true, email: true, isActive: true } });
  return user?.isActive ? { id: user.id, role: user.role, name: user.name, email: user.email } : null;
}

async function controlsFor(typeKey: string) {
  const controls = await getNotificationTypeControls();
  return { respectsPreferences: typeRespectsPreferences(controls, typeKey), disabledTransports: controls.disabledTransports[typeKey] ?? [] };
}

export type CleanerSharingNotice = {
  kind: "started" | "stopped";
  userId: string;
  jobId: string;
  jobLabel: string;
  /** Started only: the client can see the cleaner while they are on the way. */
  clientSees?: boolean;
  /** Stable occurrence id (e.g. the time log id, or `enroute:<job>:<day>`). */
  occurrenceId: string;
};

export async function sendCleanerSharingNotice(input: CleanerSharingNotice): Promise<RecipientOutcome[]> {
  const recipient = await person(input.userId);
  if (!recipient || recipient.role !== Role.CLEANER) return [];
  const typeKey = "location.sharing";
  const wording = await loadNotificationWording(typeKey);
  const clientSuffix = wording.line("client-suffix", "INBOX", {}, input.kind === "started" && input.clientSees === true);
  const inbox = wording.render(input.kind === "started" ? "cleaner-started" : "cleaner-stopped", "INBOX", { jobLabel: input.jobLabel, clientSuffix });
  return sendOfficeNotification({
    typeKey, eventKey: typeKey, eventId: `location:${input.kind}:${input.occurrenceId}:${input.userId}`,
    entity: { type: "Job", id: input.jobId }, actorId: null,
    scopeType: "JOB_ASSIGNED_CLEANER", scopeId: () => input.jobId,
    category: "jobs", severity: "INFO", jobId: input.jobId,
    subject: inbox.title, body: inbox.body, url: `/v2/cleaner/jobs/${input.jobId}`,
    transports: ["INBOX"], recipients: [recipient],
    ...(await controlsFor(typeKey)),
  });
}

export async function sendDriverSharingNotice(input: { kind: "started" | "stopped"; userId: string; routeId: string }): Promise<RecipientOutcome[]> {
  const recipient = await person(input.userId);
  if (!recipient || recipient.role !== Role.LAUNDRY) return [];
  const typeKey = "location.sharing";
  const wording = await loadNotificationWording(typeKey);
  const inbox = wording.render(input.kind === "started" ? "driver-started" : "driver-stopped", "INBOX", {});
  return sendOfficeNotification({
    typeKey, eventKey: typeKey, eventId: `location:${input.kind}:route:${input.routeId}`,
    entity: { type: "LaundryRoute", id: input.routeId }, actorId: null,
    scopeType: "STAFF_MEMBER", scopeId: (r) => r.id,
    category: "laundry", severity: "INFO", jobId: null,
    subject: inbox.title, body: inbox.body, url: "/v2/laundry",
    transports: ["INBOX"], recipients: [recipient],
    ...(await controlsFor(typeKey)),
  });
}

/**
 * The office people who may see jobs: active administrators and operations
 * managers. The JOB_OFFICE scope re-checks each manager's Jobs pack when the
 * notice is queued and again at dispatch.
 */
async function officeRecipients(): Promise<Person[]> {
  const users = await db.user.findMany({
    where: { isActive: true, role: { in: [Role.ADMIN, Role.OPS_MANAGER] } },
    select: { id: true, role: true, name: true, email: true },
  });
  return users;
}

export async function sendLeftSiteClockOutNotices(input: {
  jobId: string;
  jobLabel: string;
  cleanerId: string;
  cleanerName: string | null;
  distanceM: number;
  timeLogId: string;
}): Promise<{ cleaner: RecipientOutcome[]; office: RecipientOutcome[] }> {
  const typeKey = "job.left_site_clock_out";
  const wording = await loadNotificationWording("job.clock_changes");
  const controls = await controlsFor(typeKey);
  const cleanerNotice = wording.render("left-site", "INBOX", {});
  const officeNotice = wording.render("left-site-office", "INBOX", { cleanerName: input.cleanerName ?? "A cleaner", jobLabel: input.jobLabel, distance: input.distanceM });
  const recipient = await person(input.cleanerId);
  const cleaner = recipient
    ? await sendOfficeNotification({
        typeKey, eventKey: typeKey, eventId: `left-site:${input.timeLogId}:cleaner`,
        entity: { type: "TimeLog", id: input.timeLogId }, actorId: null,
        scopeType: "JOB_ASSIGNED_CLEANER", scopeId: () => input.jobId,
        category: "jobs", severity: "ACTION", jobId: input.jobId,
        subject: cleanerNotice.title, body: cleanerNotice.body, url: `/v2/cleaner/jobs/${input.jobId}`,
        transports: ["PUSH"], recipients: [recipient], ...controls,
      })
    : [];
  const officeTeam = await officeRecipients();
  const office = officeTeam.length
    ? await sendOfficeNotification({
        typeKey, eventKey: typeKey, eventId: `left-site:${input.timeLogId}:office`,
        entity: { type: "TimeLog", id: input.timeLogId }, actorId: null,
        scopeType: "JOB_OFFICE", scopeId: () => input.jobId,
        category: "jobs", severity: "ACTION", jobId: input.jobId,
        subject: officeNotice.title, body: officeNotice.body, url: `/v2/admin/jobs/${input.jobId}`,
        transports: ["PUSH"], recipients: officeTeam, ...controls,
      })
    : [];
  return { cleaner, office };
}
