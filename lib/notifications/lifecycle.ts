/**
 * Client lifecycle communications — the SINGLE service every stage email flows
 * through, whether fired automatically on a job transition or sent manually from
 * the client Communications hub.
 *
 * One chokepoint gives us: consistent branding (sendEmailDetailed wraps the HTML
 * via the app's email template), consistent recipient resolution (delivery
 * profiles + the client's login users), gating (auto sends carry an EmailAutoKind
 * so the admin's automation switch + suppression apply; manual sends always go),
 * a Notification-log row per send (so the client hub + activity feed show what
 * went out), and a per-job timeline note.
 *
 * Covered stages span a job start-to-finish: booking confirmed, schedule
 * changed, pre-clean reminder, cleaner assigned, en-route/started/completed
 * (delegated to the live-trip sender), report ready, invoice issued, issue
 * raised, re-clean scheduled, skip/cancellation, and a free-text custom message.
 */
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { resolveAppUrl } from "@/lib/app-url";
import { sendEmailDetailed } from "@/lib/notifications/email";
import type { EmailAutoKind } from "@/lib/notifications/email-kinds";
import { resolveClientDeliveryRecipients } from "@/lib/commercial/delivery-profiles";

// ── Stages ────────────────────────────────────────────────────────────────────

export type LifecycleStage =
  | "BOOKING_CONFIRMED"
  | "SCHEDULE_UPDATED"
  | "REMINDER"
  | "CLEANER_ASSIGNED"
  | "JOB_COMPLETED"
  | "REPORT_READY"
  | "INVOICE_ISSUED"
  | "ISSUE_RAISED"
  | "RECLEAN_SCHEDULED"
  | "SKIP_CANCELLED"
  | "CUSTOM";

export type LifecycleStageMeta = {
  stage: LifecycleStage;
  label: string;
  /** How it reads in menus / the hub. */
  description: string;
  /** EmailAutoKind used when auto-sending (gates on the automation switch). */
  kind: EmailAutoKind;
  /** Whether this stage auto-fires by default when its trigger happens. */
  autoDefault: boolean;
  /** report/invoice pull their recipients from the matching delivery profile. */
  recipientKind: "report" | "invoice" | "general";
};

export const LIFECYCLE_STAGES: Record<LifecycleStage, LifecycleStageMeta> = {
  BOOKING_CONFIRMED: { stage: "BOOKING_CONFIRMED", label: "Booking confirmed", description: "Confirm the clean is booked with the schedule.", kind: "client_job_update", autoDefault: true, recipientKind: "general" },
  SCHEDULE_UPDATED: { stage: "SCHEDULE_UPDATED", label: "Schedule changed", description: "Notify the client the date or time changed.", kind: "client_job_update", autoDefault: true, recipientKind: "general" },
  REMINDER: { stage: "REMINDER", label: "Upcoming clean reminder", description: "Remind the client of the upcoming clean.", kind: "job_reminder", autoDefault: true, recipientKind: "general" },
  CLEANER_ASSIGNED: { stage: "CLEANER_ASSIGNED", label: "Cleaner assigned", description: "Introduce the assigned cleaner.", kind: "client_job_update", autoDefault: false, recipientKind: "general" },
  JOB_COMPLETED: { stage: "JOB_COMPLETED", label: "Clean completed", description: "Confirm the clean is finished.", kind: "client_job_update", autoDefault: true, recipientKind: "general" },
  REPORT_READY: { stage: "REPORT_READY", label: "Report ready", description: "Share the completed clean report.", kind: "report_delivery", autoDefault: true, recipientKind: "report" },
  INVOICE_ISSUED: { stage: "INVOICE_ISSUED", label: "Invoice issued", description: "Send the invoice for the clean.", kind: "auto_invoice", autoDefault: true, recipientKind: "invoice" },
  ISSUE_RAISED: { stage: "ISSUE_RAISED", label: "Issue raised", description: "Let the client know we found an issue we're fixing.", kind: "client_automation", autoDefault: false, recipientKind: "general" },
  RECLEAN_SCHEDULED: { stage: "RECLEAN_SCHEDULED", label: "Re-clean scheduled", description: "Confirm a re-clean and its new schedule.", kind: "client_job_update", autoDefault: true, recipientKind: "general" },
  SKIP_CANCELLED: { stage: "SKIP_CANCELLED", label: "Skipped / cancelled", description: "Confirm a clean was skipped or cancelled.", kind: "client_job_update", autoDefault: true, recipientKind: "general" },
  CUSTOM: { stage: "CUSTOM", label: "Custom message", description: "Free-text message to the client.", kind: "follow_up", autoDefault: false, recipientKind: "general" },
};

export const LIFECYCLE_STAGE_LIST: LifecycleStageMeta[] = Object.values(LIFECYCLE_STAGES);

// ── Context ────────────────────────────────────────────────────────────────────

export type LifecycleExtra = {
  /** Override subject/intro for CUSTOM or any stage. */
  subject?: string;
  bodyHtml?: string;
  /** Amount (invoice, quote) to show. */
  amount?: number | null;
  /** New schedule text (reschedule / re-clean). */
  scheduleText?: string | null;
  /** Reason (skip/cancel/issue). */
  reason?: string | null;
  /** Cleaner name (assignment). */
  cleanerName?: string | null;
  /** Extra link (report/invoice/portal). */
  actionUrl?: string | null;
  actionLabel?: string | null;
};

type Recipient = { userId: string | null; email: string };

type LifecycleContext = {
  companyName: string;
  clientId: string | null;
  clientName: string;
  jobId: string | null;
  jobNumber: number | string | null;
  propertyName: string | null;
  serviceLabel: string | null;
  scheduledText: string | null;
  portalUrl: string;
  notificationsEnabled: boolean;
};

const AU_TZ = "Australia/Sydney";

function fmtDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toLocaleDateString("en-AU", { timeZone: AU_TZ, weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function serviceLabel(jobType: string | null | undefined): string | null {
  if (!jobType) return null;
  return String(jobType).replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n);
}

/** Build context from a job (preferred) or bare client. */
async function loadContext(input: { jobId?: string | null; clientId?: string | null }): Promise<LifecycleContext | null> {
  const settings = await getAppSettings();
  const companyName = settings.companyName || "sNeek Property Services";

  if (input.jobId) {
    const job = await db.job.findUnique({
      where: { id: input.jobId },
      select: {
        id: true,
        jobNumber: true,
        jobType: true,
        scheduledDate: true,
        startTime: true,
        property: {
          select: {
            name: true,
            suburb: true,
            client: { select: { id: true, name: true, notificationPref: { select: { notificationsEnabled: true } } } },
          },
        },
      },
    });
    if (!job) return null;
    const client = job.property?.client ?? null;
    const dateText = fmtDate(job.scheduledDate);
    const scheduledText = dateText ? `${dateText}${job.startTime ? ` at ${job.startTime}` : ""}` : null;
    return {
      companyName,
      clientId: client?.id ?? null,
      clientName: client?.name ?? "there",
      jobId: job.id,
      jobNumber: job.jobNumber ?? null,
      propertyName: job.property ? (job.property.suburb ? `${job.property.name} (${job.property.suburb})` : job.property.name) : null,
      serviceLabel: serviceLabel(job.jobType as string),
      scheduledText,
      portalUrl: resolveAppUrl(`/client/jobs/${job.id}`),
      notificationsEnabled: client?.notificationPref?.notificationsEnabled ?? true,
    };
  }

  if (input.clientId) {
    const client = await db.client.findUnique({
      where: { id: input.clientId },
      select: { id: true, name: true, notificationPref: { select: { notificationsEnabled: true } } },
    });
    if (!client) return null;
    return {
      companyName,
      clientId: client.id,
      clientName: client.name,
      jobId: null,
      jobNumber: null,
      propertyName: null,
      serviceLabel: null,
      scheduledText: null,
      portalUrl: resolveAppUrl(`/client`),
      notificationsEnabled: client.notificationPref?.notificationsEnabled ?? true,
    };
  }

  return null;
}

async function resolveRecipients(clientId: string | null, kind: "report" | "invoice" | "general"): Promise<Recipient[]> {
  if (!clientId) return [];
  // Delivery profiles handle report/invoice; general falls back to the client's users.
  if (kind === "report" || kind === "invoice") {
    const emails = await resolveClientDeliveryRecipients({ clientId, fallbackEmail: null, kind });
    if (emails.length) return emails.map((email) => ({ userId: null, email }));
  }
  const users = await db.user.findMany({
    where: { clientId, role: Role.CLIENT, isActive: true },
    select: { id: true, email: true },
  });
  return users.filter((u) => u.email).map((u) => ({ userId: u.id, email: u.email as string }));
}

// ── Rendering ──────────────────────────────────────────────────────────────────

function greeting(ctx: LifecycleContext) {
  const first = String(ctx.clientName || "there").split(/\s+/)[0];
  return `<p>Hi ${first},</p>`;
}

function actionButton(url: string | null | undefined, label: string) {
  if (!url) return "";
  return `<p style="margin:18px 0;"><a href="${url}" style="background:#0f172a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block;">${label}</a></p>`;
}

function signoff(ctx: LifecycleContext) {
  return `<p style="margin-top:18px;">Warm regards,<br/>The ${ctx.companyName} team</p>`;
}

/** Render subject + inner HTML for a stage. sendEmailDetailed brands the wrapper. */
export function renderLifecycleEmail(stage: LifecycleStage, ctx: LifecycleContext, extra: LifecycleExtra = {}): { subject: string; html: string } {
  const ref = ctx.jobNumber ? `#${ctx.jobNumber}` : "";
  const where = ctx.propertyName ? ` at <strong>${ctx.propertyName}</strong>` : "";
  const service = ctx.serviceLabel ? `${ctx.serviceLabel} clean` : "clean";
  const when = extra.scheduleText || ctx.scheduledText;

  let subject: string;
  let body: string;

  switch (stage) {
    case "BOOKING_CONFIRMED":
      subject = `${ctx.companyName}: Your ${service} is booked${ref ? ` ${ref}` : ""}`;
      body = `<p>Your ${service}${where} is confirmed${when ? ` for <strong>${when}</strong>` : ""}.</p><p>We'll keep you posted at every step — you'll get a heads-up when your cleaner is on the way.</p>`;
      break;
    case "SCHEDULE_UPDATED":
      subject = `${ctx.companyName}: Your clean has been rescheduled${ref ? ` ${ref}` : ""}`;
      body = `<p>The schedule for your ${service}${where} has been updated.</p>${when ? `<p><strong>New time:</strong> ${when}</p>` : ""}${extra.reason ? `<p>${extra.reason}</p>` : ""}`;
      break;
    case "REMINDER":
      subject = `${ctx.companyName}: Reminder — your clean is coming up`;
      body = `<p>Just a reminder that your ${service}${where} is scheduled${when ? ` for <strong>${when}</strong>` : " soon"}.</p><p>Please make sure our team can access the property. Reply if anything's changed.</p>`;
      break;
    case "CLEANER_ASSIGNED":
      subject = `${ctx.companyName}: Your cleaner is assigned`;
      body = `<p><strong>${extra.cleanerName || "Your cleaner"}</strong> will be looking after your ${service}${where}${when ? ` on <strong>${when}</strong>` : ""}.</p>`;
      break;
    case "JOB_COMPLETED":
      subject = `${ctx.companyName}: Your clean is complete`;
      body = `<p>Great news — your ${service}${where} is complete.</p><p>Your report will follow shortly. Thank you for choosing ${ctx.companyName}.</p>`;
      break;
    case "REPORT_READY":
      subject = `${ctx.companyName}: Your clean report is ready`;
      body = `<p>Your report for the ${service}${where}${when ? ` on ${when}` : ""} is ready.</p>${extra.bodyHtml ?? ""}`;
      break;
    case "INVOICE_ISSUED":
      subject = `${ctx.companyName}: Invoice for your clean${ref ? ` ${ref}` : ""}`;
      body = `<p>Please find your invoice for the ${service}${where}${when ? ` on ${when}` : ""}.</p>${extra.amount != null ? `<p><strong>Amount due:</strong> ${fmtMoney(extra.amount)}</p>` : ""}`;
      break;
    case "ISSUE_RAISED":
      subject = `${ctx.companyName}: We're following up on your clean`;
      body = `<p>During our quality check on your ${service}${where} we spotted something we want to put right.</p>${extra.reason ? `<p>${extra.reason}</p>` : ""}<p>We'll be in touch to arrange a re-clean at no extra cost.</p>`;
      break;
    case "RECLEAN_SCHEDULED":
      subject = `${ctx.companyName}: Your re-clean is scheduled`;
      body = `<p>We've scheduled a complimentary re-clean${where}${when ? ` for <strong>${when}</strong>` : ""} to make sure everything is perfect.</p>${extra.reason ? `<p>${extra.reason}</p>` : ""}`;
      break;
    case "SKIP_CANCELLED":
      subject = `${ctx.companyName}: Your clean has been ${extra.reason ? "cancelled" : "skipped"}`;
      body = `<p>Your ${service}${where}${when ? ` scheduled for ${when}` : ""} has been ${extra.reason ? "cancelled" : "skipped"}.</p>${extra.reason ? `<p>${extra.reason}</p>` : ""}<p>Get in touch any time to rebook.</p>`;
      break;
    case "CUSTOM":
    default:
      subject = extra.subject || `${ctx.companyName}: An update on your clean`;
      body = extra.bodyHtml || `<p>${extra.reason ?? ""}</p>`;
      break;
  }

  const html = `${greeting(ctx)}${body}${actionButton(extra.actionUrl, extra.actionLabel || "View in your portal")}${stage !== "CUSTOM" && !extra.actionUrl ? actionButton(ctx.portalUrl, "View in your portal") : ""}${signoff(ctx)}`;
  return { subject: extra.subject || subject, html };
}

// ── Send / preview ───────────────────────────────────────────────────────────

export type LifecycleSendInput = {
  jobId?: string | null;
  clientId?: string | null;
  stage: LifecycleStage;
  /** auto = gated by the automation switch + client prefs; manual = always sends. */
  mode?: "auto" | "manual";
  extra?: LifecycleExtra;
  attachments?: Array<{ filename: string; content: Buffer }>;
};

export type LifecyclePreview = {
  ok: boolean;
  stage: LifecycleStage;
  subject: string;
  html: string;
  recipients: string[];
  reason?: string;
};

/** Render without sending — powers the hub's "preview before send". */
export async function previewLifecycleEmail(input: LifecycleSendInput): Promise<LifecyclePreview> {
  const ctx = await loadContext({ jobId: input.jobId, clientId: input.clientId });
  if (!ctx) return { ok: false, stage: input.stage, subject: "", html: "", recipients: [], reason: "No client found for this job." };
  const meta = LIFECYCLE_STAGES[input.stage];
  const recipients = await resolveRecipients(ctx.clientId, meta.recipientKind);
  const { subject, html } = renderLifecycleEmail(input.stage, ctx, input.extra ?? {});
  return { ok: recipients.length > 0, stage: input.stage, subject, html, recipients: recipients.map((r) => r.email), reason: recipients.length ? undefined : "No client email on file." };
}

export type LifecycleSendResult = { sent: boolean; recipients: string[]; skipped?: string };

/**
 * Send a lifecycle email to the client. Best-effort in auto mode (never throws —
 * so it can't break the job flow it's fired from); manual mode surfaces failures.
 */
export async function sendLifecycleEmail(input: LifecycleSendInput): Promise<LifecycleSendResult> {
  const mode = input.mode ?? "auto";
  try {
    const ctx = await loadContext({ jobId: input.jobId, clientId: input.clientId });
    if (!ctx) return { sent: false, recipients: [], skipped: "no-client" };
    if (mode === "auto" && !ctx.notificationsEnabled) return { sent: false, recipients: [], skipped: "client-opted-out" };

    const meta = LIFECYCLE_STAGES[input.stage];
    const recipients = await resolveRecipients(ctx.clientId, meta.recipientKind);
    if (recipients.length === 0) return { sent: false, recipients: [], skipped: "no-recipients" };

    const { subject, html } = renderLifecycleEmail(input.stage, ctx, input.extra ?? {});
    const sentTo: string[] = [];

    for (const r of recipients) {
      const result = await sendEmailDetailed({
        to: r.email,
        subject,
        html,
        attachments: input.attachments,
        // Auto sends carry a kind → gated by the admin automation switch. Manual
        // sends omit kind → always deliver.
        ...(mode === "auto" ? { kind: meta.kind } : { transactional: true }),
      });
      // Log every send to the Notification table so the client hub + activity
      // feed reflect it. Keyed to the recipient user + job where known.
      await db.notification
        .create({
          data: {
            userId: r.userId ?? undefined,
            jobId: ctx.jobId ?? undefined,
            channel: NotificationChannel.EMAIL,
            subject: `[${meta.label}] ${subject}`,
            body: `Lifecycle email (${input.stage}) sent to ${r.email}`,
            status: result.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
            sentAt: result.ok ? new Date() : undefined,
            errorMsg: result.ok ? undefined : result.error ?? "Email delivery failed.",
            externalId: result.externalId ?? undefined,
            deliveryStatus: result.ok ? "PENDING" : undefined,
          },
        })
        .catch(() => {});
      if (result.ok || result.skipped) sentTo.push(r.email);
    }

    return { sent: sentTo.length > 0, recipients: sentTo };
  } catch (err) {
    if (mode === "manual") throw err;
    console.error("[sendLifecycleEmail] error:", err);
    return { sent: false, recipients: [], skipped: "error" };
  }
}
