/**
 * Accountability notification helpers (Phase 8b).
 *
 * Every helper funnels through `deliverNotificationToRecipients` (the single
 * web-push / email / SMS chokepoint) and resolves its own recipients. They are
 * fire-and-forget by contract: each wraps its body in try/catch and never
 * throws into the caller, so a notification failure can never void the route or
 * transaction that fired it. Callers should still `void helper(...).catch(...)`
 * for safety, but a throw here is already impossible.
 *
 * Category reuse (no new NotificationCategory was introduced):
 *   - cleaner-facing quality events  → "jobs"
 *   - admin management/escalation    → "approvals"
 *   - restock run created            → "shopping"
 */
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";
import { resolveAppUrl } from "@/lib/app-url";
import { getAppSettings } from "@/lib/settings";
import { logger } from "@/lib/logger";
import { formatInTimeZone } from "date-fns-tz";
import { getPresignedDownloadUrl } from "@/lib/s3";
import { displayKeyFor, normalizeQaPhotoRefs } from "@/lib/qa/annotation-composite";
import { buildQaResultEmail } from "@/lib/notifications/qa-result-email";

type AdminRecipient = {
  id: string;
  role: Role;
  email: string | null;
  phone: string | null;
  name: string | null;
};

async function getAdminRecipients(): Promise<AdminRecipient[]> {
  return db.user.findMany({
    where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
    select: { id: true, role: true, email: true, phone: true, name: true },
  });
}

async function getCleanerRecipient(cleanerId: string) {
  const user = await db.user.findUnique({
    where: { id: cleanerId },
    select: { id: true, role: true, email: true, phone: true, name: true, isActive: true },
  });
  if (!user || !user.isActive) return null;
  return { id: user.id, role: user.role, email: user.email, phone: user.phone, name: user.name };
}

function emailShell(title: string, bodyHtml: string, actionUrl?: string, actionLabel?: string) {
  return `<div style="font-family:Arial,sans-serif;color:#111;">
    <h2 style="margin:0 0 8px;">${title}</h2>
    <div style="color:#555;margin:0 0 12px;">${bodyHtml}</div>
    ${
      actionUrl
        ? `<p style="margin:16px 0;"><a href="${actionUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;">${
            actionLabel ?? "Open"
          }</a></p>`
        : ""
    }
  </div>`;
}

/** Prettify a category key when settings hold no label for it. */
function humanizeKey(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * QA result to the cleaner(s) who did the job.
 *
 * This used to send two lines — "This clean did not pass inspection." plus a
 * bare count — naming not a single actual issue. It now reads the `QaIssue`
 * rows the inspection just wrote and sends what went wrong, where, with QA's
 * markup burned into the photo, the arithmetic behind the score (using the
 * ADMIN-CONFIGURED deduction values, never hardcoded), and what to focus on
 * next.
 *
 * Recipients: EVERY non-removed assignment, not just the primary. On a shared
 * job the second cleaner previously heard nothing at all about an inspection of
 * work they had done.
 *
 * `cleanerId` remains accepted for callers that know the specific payee; when
 * omitted the job's assignments are used.
 */
export async function notifyQaResultToCleaner(input: {
  jobId: string;
  cleanerId?: string | null;
  score: number;
  rating?: string | null;
  passed: boolean;
  propertyName?: string | null;
  /** Legacy summary text — kept for callers that still pass it (SMS/web copy). */
  issueSummary?: string | null;
  rectificationSummary?: string | null;
  managementReview?: boolean;
}): Promise<void> {
  try {
    const settings = await getAppSettings();

    // Recipients: the named cleaner if given, else everyone still on the job.
    let recipientIds: string[] = [];
    if (input.cleanerId) {
      recipientIds = [input.cleanerId];
    } else {
      const assignments = await db.jobAssignment.findMany({
        where: { jobId: input.jobId, removedAt: null },
        select: { userId: true },
      });
      recipientIds = assignments.map((a) => a.userId);
    }
    const recipients = (await Promise.all(recipientIds.map((id) => getCleanerRecipient(id)))).filter(
      (r): r is NonNullable<typeof r> => Boolean(r)
    );
    if (recipients.length === 0) return;

    const [job, issues] = await Promise.all([
      db.job.findUnique({
        where: { id: input.jobId },
        select: { jobNumber: true, scheduledDate: true, property: { select: { name: true } } },
      }),
      db.qaIssue.findMany({
        where: { jobId: input.jobId },
        orderBy: { createdAt: "asc" },
        select: {
          severity: true,
          category: true,
          description: true,
          guestReadyImpact: true,
          qaPhotoKeys: true,
        },
      }),
    ]);

    const categoryLabels = new Map(
      (settings.accountability?.issueCategories ?? []).map((c) => [c.key, c.label])
    );

    // One representative photo per issue — the FLATTENED composite, so QA's
    // markup is visible. Email clients cannot stack a transparent overlay.
    const emailIssues = await Promise.all(
      issues.map(async (issue) => {
        const refs = normalizeQaPhotoRefs(issue.qaPhotoKeys);
        let photoUrl: string | null = null;
        if (refs[0]) {
          photoUrl = await getPresignedDownloadUrl(displayKeyFor(refs[0]), 60 * 60 * 24 * 7).catch(
            () => null
          );
        }
        return {
          severity: String(issue.severity),
          categoryLabel: categoryLabels.get(issue.category) ?? humanizeKey(issue.category),
          description: issue.description,
          guestReadyImpact: issue.guestReadyImpact ?? false,
          photoUrl,
        };
      })
    );

    const qualityUrl = resolveAppUrl("/v2/cleaner/quality");
    const built = buildQaResultEmail({
      companyName: settings.companyName,
      propertyName: input.propertyName ?? job?.property?.name ?? null,
      jobNumber: job?.jobNumber ?? null,
      jobDateLabel: job?.scheduledDate
        ? formatInTimeZone(job.scheduledDate, "Australia/Sydney", "dd MMM yyyy")
        : null,
      score: input.score,
      rating: input.rating ?? null,
      passed: input.passed,
      issues: emailIssues,
      deductions: {
        minor: settings.accountability?.scoring?.minorDeduction,
        major: settings.accountability?.scoring?.majorDeduction,
        critical: settings.accountability?.scoring?.criticalDeduction,
      },
      coachingNote: input.rectificationSummary ?? null,
      qualityUrl,
      managementReview: input.managementReview ?? false,
    });

    const shortSummary = input.passed
      ? `QA passed (${Math.round(input.score)}%)`
      : `QA needs attention (${Math.round(input.score)}%)${
          input.issueSummary ? ` — ${input.issueSummary}` : ""
        }`;

    await deliverNotificationToRecipients({
      recipients,
      category: "jobs",
      jobId: input.jobId,
      // Point at the quality hub, where the feedback (and now the report
      // download) lives. The old link went to a v1 path these cleaners no
      // longer use.
      url: qualityUrl,
      web: { subject: shortSummary, body: built.text.split("\n").slice(0, 3).join(" ") },
      email: { subject: built.subject, html: built.html },
      sms: `${settings.companyName}: ${shortSummary}. See the app for details.`,
    });
  } catch (err) {
    logger.error({ err, jobId: input.jobId }, "[accountability] notifyQaResultToCleaner failed");
  }
}

/** Admin escalation: a review was routed to management review (e.g. a critical). */
export async function notifyManagementReviewFlagged(input: {
  jobId: string;
  cleanerName?: string | null;
  propertyName?: string | null;
  reason?: string | null;
}): Promise<void> {
  try {
    const admins = await getAdminRecipients();
    if (admins.length === 0) return;
    const settings = await getAppSettings();
    const who = input.cleanerName ? ` — ${input.cleanerName}` : "";
    const where = input.propertyName ? ` at ${input.propertyName}` : "";
    const subject = `QA flagged for management review${where}`;
    const body = `A QA inspection${where}${who} was routed to management review.${
      input.reason ? ` ${input.reason}` : ""
    }`;
    const url = resolveAppUrl(`/admin/jobs/${input.jobId}`);
    await deliverNotificationToRecipients({
      recipients: admins,
      category: "approvals",
      jobId: input.jobId,
      url,
      web: { subject, body },
      email: {
        subject: `${settings.companyName}: ${subject}`,
        html: emailShell(subject, `<p>${body}</p>`, url, "Review job"),
      },
    });
  } catch (err) {
    logger.error({ err, jobId: input.jobId }, "[accountability] notifyManagementReviewFlagged failed");
  }
}

/** Admin alert: the inspection surfaced suspected false confirmations. */
export async function notifyFalseConfirmationSuspected(input: {
  jobId: string;
  count: number;
  cleanerName?: string | null;
  propertyName?: string | null;
}): Promise<void> {
  try {
    if (!(input.count > 0)) return;
    const admins = await getAdminRecipients();
    if (admins.length === 0) return;
    const settings = await getAppSettings();
    const who = input.cleanerName ? ` by ${input.cleanerName}` : "";
    const where = input.propertyName ? ` at ${input.propertyName}` : "";
    const subject = `${input.count} suspected false confirmation${input.count === 1 ? "" : "s"}${where}`;
    const body = `A QA inspection${where} flagged ${input.count} suspected false confirmation${
      input.count === 1 ? "" : "s"
    }${who}. Please review.`;
    const url = resolveAppUrl(`/admin/jobs/${input.jobId}`);
    await deliverNotificationToRecipients({
      recipients: admins,
      category: "approvals",
      jobId: input.jobId,
      url,
      web: { subject, body },
      email: {
        subject: `${settings.companyName}: ${subject}`,
        html: emailShell(subject, `<p>${body}</p>`, url, "Review job"),
      },
    });
  } catch (err) {
    logger.error({ err, jobId: input.jobId }, "[accountability] notifyFalseConfirmationSuspected failed");
  }
}

/**
 * Rework OFFER to the original cleaner: QA failed their clean and is giving them
 * the chance to come back and fix it themselves (unpaid, no deduction) before it
 * is reassigned to someone else at their cost. Time-boxed — see
 * lib/qa/rework-offers.ts.
 */
export async function notifyReworkOfferToCleaner(input: {
  /** The REWORK job created for the fix. */
  jobId: string;
  cleanerId: string;
  /** QaAssignment carrying the offer (the respond endpoint keys off it). */
  assignmentId: string;
  propertyName?: string | null;
  reason?: string | null;
  expiresAt: Date;
}): Promise<void> {
  try {
    const cleaner = await getCleanerRecipient(input.cleanerId);
    if (!cleaner) return;
    const settings = await getAppSettings();
    const where = input.propertyName ? ` at ${input.propertyName}` : "";
    const minutes = Math.max(1, Math.round((input.expiresAt.getTime() - Date.now()) / 60_000));
    const subject = `Rework offered${where} — respond within ${minutes} min`;
    const body = [
      `QA flagged items on your clean${where}.`,
      input.reason ? `Reason: ${input.reason}` : null,
      "You can go back and fix it yourself at no cost to you. If you decline or the offer lapses, it is reassigned to another cleaner and the rework pay is deducted from your job.",
    ]
      .filter(Boolean)
      .join(" ");
    const url = resolveAppUrl(`/cleaner/jobs/${input.jobId}`);
    await deliverNotificationToRecipients({
      recipients: [cleaner],
      category: "jobs",
      jobId: input.jobId,
      url,
      web: { subject, body },
      email: {
        subject: `${settings.companyName}: ${subject}`,
        html: emailShell(subject, `<p>${body}</p>`, url, "View rework"),
      },
      sms: `${settings.companyName}: ${subject}. Open the app to accept or decline.`,
    });
  } catch (err) {
    logger.error({ err, jobId: input.jobId }, "[accountability] notifyReworkOfferToCleaner failed");
  }
}

/** Bonus outcome (approved / rejected) to the cleaner. */
export async function notifyBonusOutcomeToCleaner(input: {
  cleanerId: string;
  title: string;
  approved: boolean;
  amount?: number | null;
  jobId?: string | null;
}): Promise<void> {
  try {
    const cleaner = await getCleanerRecipient(input.cleanerId);
    if (!cleaner) return;
    const settings = await getAppSettings();
    const amountStr =
      input.approved && input.amount != null && Number.isFinite(Number(input.amount))
        ? ` ($${Number(input.amount).toFixed(2)})`
        : "";
    const subject = input.approved
      ? `Bonus approved${amountStr}`
      : "Bonus not approved";
    const body = input.approved
      ? `Your ${input.title} has been approved${amountStr} and will be included in payroll.`
      : `Your ${input.title} was not approved.`;
    const url = resolveAppUrl("/cleaner/pay-requests");
    await deliverNotificationToRecipients({
      recipients: [cleaner],
      category: "jobs",
      jobId: input.jobId ?? null,
      url,
      web: { subject, body },
      email: {
        subject: `${settings.companyName}: ${subject}`,
        html: emailShell(subject, `<p>${body}</p>`, url, "View pay requests"),
      },
    });
  } catch (err) {
    logger.error({ err, cleanerId: input.cleanerId }, "[accountability] notifyBonusOutcomeToCleaner failed");
  }
}

/** Coaching record created → the cleaner it concerns. */
export async function notifyCoachingCreated(input: {
  cleanerId: string;
  coachingId: string;
  type: string;
  reason: string;
  retrainingRequired?: boolean;
}): Promise<void> {
  try {
    const cleaner = await getCleanerRecipient(input.cleanerId);
    if (!cleaner) return;
    const settings = await getAppSettings();
    const typeLabel = input.type.replace(/_/g, " ").toLowerCase();
    const subject = `New coaching record: ${typeLabel}`;
    const body = `${input.reason}${
      input.retrainingRequired ? " Retraining is required — please acknowledge." : " Please review and acknowledge."
    }`;
    const url = resolveAppUrl(`/cleaner/coaching/${input.coachingId}`);
    await deliverNotificationToRecipients({
      recipients: [cleaner],
      category: "jobs",
      url,
      web: { subject, body },
      email: {
        subject: `${settings.companyName}: ${subject}`,
        html: emailShell(subject, `<p>${body}</p>`, url, "View coaching"),
      },
    });
  } catch (err) {
    logger.error({ err, coachingId: input.coachingId }, "[accountability] notifyCoachingCreated failed");
  }
}

/** Coaching acknowledged by the cleaner → notify the record's creator. */
export async function notifyCoachingAcknowledged(input: {
  createdById: string;
  coachingId: string;
  cleanerName?: string | null;
}): Promise<void> {
  try {
    const creator = await db.user.findUnique({
      where: { id: input.createdById },
      select: { id: true, role: true, email: true, phone: true, name: true, isActive: true },
    });
    if (!creator || !creator.isActive) return;
    const settings = await getAppSettings();
    const who = input.cleanerName ? input.cleanerName : "The cleaner";
    const subject = "Coaching record acknowledged";
    const body = `${who} has acknowledged the coaching record you created.`;
    const url = resolveAppUrl(`/admin/accountability/coaching/${input.coachingId}`);
    await deliverNotificationToRecipients({
      recipients: [
        { id: creator.id, role: creator.role, email: creator.email, phone: creator.phone, name: creator.name },
      ],
      category: "approvals",
      url,
      web: { subject, body },
      email: {
        subject: `${settings.companyName}: ${subject}`,
        html: emailShell(subject, `<p>${body}</p>`, url, "View coaching"),
      },
    });
  } catch (err) {
    logger.error({ err, coachingId: input.coachingId }, "[accountability] notifyCoachingAcknowledged failed");
  }
}

/** QA score manually adjusted by an admin → notify the cleaner. */
export async function notifyScoreAdjusted(input: {
  jobId: string;
  cleanerId: string;
  newScore: number;
  reason: string;
  propertyName?: string | null;
}): Promise<void> {
  try {
    const cleaner = await getCleanerRecipient(input.cleanerId);
    if (!cleaner) return;
    const settings = await getAppSettings();
    const where = input.propertyName ? ` at ${input.propertyName}` : "";
    const subject = `QA score updated to ${Math.round(input.newScore)}${where}`;
    const body = `An admin adjusted your QA score${where} to ${Math.round(input.newScore)}. Reason: ${input.reason}`;
    const url = resolveAppUrl(`/cleaner/jobs/${input.jobId}`);
    await deliverNotificationToRecipients({
      recipients: [cleaner],
      category: "jobs",
      jobId: input.jobId,
      url,
      web: { subject, body },
      email: {
        subject: `${settings.companyName}: ${subject}`,
        html: emailShell(subject, `<p>${body}</p>`, url, "View job"),
      },
    });
  } catch (err) {
    logger.error({ err, jobId: input.jobId }, "[accountability] notifyScoreAdjusted failed");
  }
}

/**
 * Recurring-pattern alert to admins (same cleaner/property + category over the
 * configured window). Exported for future wiring even if not yet called.
 */
export async function notifyRecurringPatternAlert(input: {
  cleanerName?: string | null;
  propertyName?: string | null;
  category: string;
  count: number;
  windowDays: number;
  cleanerId?: string | null;
}): Promise<void> {
  try {
    const admins = await getAdminRecipients();
    if (admins.length === 0) return;
    const settings = await getAppSettings();
    const subjectWho =
      input.cleanerName ?? input.propertyName ?? "A cleaner";
    const categoryLabel = input.category.replace(/_/g, " ");
    const subject = `Recurring issue pattern: ${categoryLabel}`;
    const body = `${subjectWho} has ${input.count} ${categoryLabel} issue${
      input.count === 1 ? "" : "s"
    } in the last ${input.windowDays} day${input.windowDays === 1 ? "" : "s"}.${
      input.propertyName && input.cleanerName ? ` Property: ${input.propertyName}.` : ""
    }`;
    const url = resolveAppUrl("/admin/accountability");
    await deliverNotificationToRecipients({
      recipients: admins,
      category: "approvals",
      url,
      web: { subject, body },
      email: {
        subject: `${settings.companyName}: ${subject}`,
        html: emailShell(subject, `<p>${body}</p>`, url, "Open accountability"),
      },
    });
  } catch (err) {
    logger.error({ err }, "[accountability] notifyRecurringPatternAlert failed");
  }
}

/** A restock ShoppingRun was auto-created from low stock → notify admins. */
export async function notifyRestockRunCreated(input: {
  runId: string;
  propertyName?: string | null;
  itemCount: number;
}): Promise<void> {
  try {
    const admins = await getAdminRecipients();
    if (admins.length === 0) return;
    const settings = await getAppSettings();
    const where = input.propertyName ? ` at ${input.propertyName}` : "";
    const subject = `Auto shopping run created${where}`;
    const body = `${input.itemCount} low-stock item${
      input.itemCount === 1 ? "" : "s"
    }${where} were added to an automatically created shopping run.`;
    const url = resolveAppUrl("/admin/shopping-runs");
    await deliverNotificationToRecipients({
      recipients: admins,
      category: "shopping",
      url,
      web: { subject, body },
      email: {
        subject: `${settings.companyName}: ${subject}`,
        html: emailShell(subject, `<p>${body}</p>`, url, "Open shopping run"),
      },
    });
  } catch (err) {
    logger.error({ err, runId: input.runId }, "[accountability] notifyRestockRunCreated failed");
  }
}

/** Optional streak-progress nudge to a cleaner. Exported for future wiring. */
export async function notifyStreakProgress(input: {
  cleanerId: string;
  streak: number;
  nextThreshold?: number | null;
}): Promise<void> {
  try {
    const cleaner = await getCleanerRecipient(input.cleanerId);
    if (!cleaner) return;
    const settings = await getAppSettings();
    const subject = `Quality streak: ${input.streak} clean${input.streak === 1 ? "" : "s"}`;
    const toGo =
      input.nextThreshold != null && input.nextThreshold > input.streak
        ? ` ${input.nextThreshold - input.streak} more to your next bonus.`
        : "";
    const body = `You're on a streak of ${input.streak} high-quality clean${
      input.streak === 1 ? "" : "s"
    }.${toGo}`;
    await deliverNotificationToRecipients({
      recipients: [cleaner],
      category: "jobs",
      web: { subject, body },
      email: {
        subject: `${settings.companyName}: ${subject}`,
        html: emailShell(subject, `<p>${body}</p>`),
      },
    });
  } catch (err) {
    logger.error({ err, cleanerId: input.cleanerId }, "[accountability] notifyStreakProgress failed");
  }
}
