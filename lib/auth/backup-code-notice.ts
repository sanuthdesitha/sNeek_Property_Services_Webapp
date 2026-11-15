import "server-only";
/**
 * "A backup code was used to sign in" (2026-11-17; catalog
 * `account.backup_code_used`): an inbox notice and an email to the account
 * holder, through the notification intent pipeline (sendOfficeNotification)
 * with explicit transports INBOX and EMAIL; never SMS or device push. Scope
 * ACCOUNT_HOLDER (the person, re-checked at dispatch). Once per code used:
 * the event id names the used code's row, which can be used only once, so a
 * retried call queues nothing new. Queued is not delivered.
 *
 * The notice says when (organisation time), which browser (as it described
 * itself, otherwise "browser not recorded") and how many codes are left. It
 * never carries the code.
 */
import type { Role } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { sendOfficeNotification, type RecipientOutcome } from "@/lib/notifications/office-sends";
import { getNotificationTypeControls } from "@/lib/notifications/type-controls";
import { loadNotificationWording } from "@/lib/notifications/wording/render";
import { buildDesignedEmail } from "@/lib/email-design/build-email";
import { resolveAppUrl } from "@/lib/app-url";
import { getAppSettings } from "@/lib/settings";
import { describeUserAgent } from "./user-agent-label";
import { twoStepSettingsPath } from "./two-step-policy";

export const BACKUP_CODE_USED_TYPE = "account.backup_code_used";

export type BackupCodeUsedNoticeInput = {
  user: { id: string; role: Role; name: string | null; email: string | null };
  codeId: string;
  usedAt: Date;
  remaining: number;
  userAgent: string | null;
};

export function backupCodeUsedFacts(input: { usedAt: Date; userAgent: string | null; timeZone: string }) {
  const usedAt = `${formatInTimeZone(input.usedAt, input.timeZone, "EEE d MMM yyyy, h:mm aaa")} (${input.timeZone.split("/").pop()?.replace(/_/g, " ") ?? input.timeZone} time)`;
  const browser = describeUserAgent(input.userAgent).label ?? "browser not recorded";
  return { usedAt, browser };
}

export async function sendBackupCodeUsedNotice(input: BackupCodeUsedNoticeInput): Promise<RecipientOutcome[]> {
  const settings = await getAppSettings();
  const timeZone = settings.timezone || "Australia/Sydney";
  const facts = backupCodeUsedFacts({ usedAt: input.usedAt, userAgent: input.userAgent, timeZone });
  const remaining = String(input.remaining);
  const settingsPath = twoStepSettingsPath(input.user.role);
  const wording = await loadNotificationWording(BACKUP_CODE_USED_TYPE);
  const inbox = wording.render("used", "INBOX", { usedAt: facts.usedAt, browser: facts.browser, remaining });
  const email = buildDesignedEmail(settings, "twoFactorBackupCodeUsed", {
    userName: input.user.name ?? "",
    usedAt: facts.usedAt,
    browser: facts.browser,
    remaining,
    profileUrl: resolveAppUrl(settingsPath),
  });
  const controls = await getNotificationTypeControls();
  return sendOfficeNotification({
    typeKey: BACKUP_CODE_USED_TYPE,
    eventKey: "account.backup_code_used",
    eventId: `backup-code-used:${input.codeId}`,
    entity: { type: "TwoFactorBackupCode", id: input.codeId },
    actorId: input.user.id,
    scopeType: "ACCOUNT_HOLDER",
    scopeId: (recipient) => recipient.id,
    category: "account",
    severity: "ACTION",
    jobId: null,
    subject: inbox.title,
    body: inbox.body,
    url: settingsPath,
    transports: ["INBOX", "EMAIL"],
    email: () => ({ subject: email.subject, html: email.html }),
    recipients: [input.user],
    // A security notice to the account holder: personal preferences do not silence it.
    respectsPreferences: false,
    disabledTransports: controls.disabledTransports[BACKUP_CODE_USED_TYPE] ?? [],
  });
}
