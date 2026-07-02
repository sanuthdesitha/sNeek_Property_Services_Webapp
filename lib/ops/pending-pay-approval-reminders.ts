import { PayAdjustmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";
import { resolveAppUrl } from "@/lib/app-url";
import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";

const STATE_KEY = "pending_pay_approval_reminder_v1";
/** Only remind about requests that have been waiting at least this long. */
const AGING_HOURS = 24;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n: number): string {
  return Number(n ?? 0).toLocaleString("en-AU", { style: "currency", currency: "AUD" });
}

async function alreadySentToday(dateKey: string): Promise<boolean> {
  const row = await db.appSetting.findUnique({ where: { key: STATE_KEY } });
  const value = (row?.value ?? {}) as { lastDispatchDate?: string };
  return value.lastDispatchDate === dateKey;
}

async function markSentToday(dateKey: string): Promise<void> {
  await db.appSetting.upsert({
    where: { key: STATE_KEY },
    create: { key: STATE_KEY, value: { lastDispatchDate: dateKey } as any },
    update: { value: { lastDispatchDate: dateKey } as any },
  });
}

/**
 * Daily reminder to admins/ops about extra-pay (CleanerPayAdjustment) requests
 * that are still PENDING and have been waiting a while. Sending is skipped when
 * nothing is aging, and de-duped to once per Sydney day. Fires from the web
 * scheduler / worker.
 */
export async function sendPendingPayApprovalReminders(
  options: { now?: Date; ignoreWindow?: boolean } = {},
) {
  const now = options.now ?? new Date();
  const dateKey = now.toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" }); // yyyy-mm-dd

  if (!options.ignoreWindow && (await alreadySentToday(dateKey))) {
    return { sent: 0, pending: 0, skipped: "already sent today" as const };
  }

  const cutoff = new Date(now.getTime() - AGING_HOURS * 3_600_000);
  const pending = await db.cleanerPayAdjustment.findMany({
    where: {
      status: PayAdjustmentStatus.PENDING,
      requestedAt: { lte: cutoff },
    },
    select: {
      id: true,
      title: true,
      requestedAmount: true,
      approvedAmount: true,
      requestedAt: true,
      cleaner: { select: { name: true, email: true } },
      job: { select: { property: { select: { name: true } } } },
    },
    orderBy: { requestedAt: "asc" },
  });

  if (pending.length === 0) {
    if (!options.ignoreWindow) await markSentToday(dateKey);
    return { sent: 0, pending: 0, skipped: "nothing aging" as const };
  }

  const totalAmount = pending.reduce((sum, p) => sum + Number(p.approvedAmount ?? p.requestedAmount ?? 0), 0);
  const rowsHtml = pending
    .map((p) => {
      const who = escapeHtml(p.cleaner?.name?.trim() || p.cleaner?.email || "Cleaner");
      const what = escapeHtml(p.title?.trim() || p.job?.property?.name || "Extra payment");
      const waited = Math.floor((now.getTime() - p.requestedAt.getTime()) / 3_600_000);
      return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${who}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${what}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${money(
          Number(p.requestedAmount ?? 0),
        )}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${waited}h</td>
      </tr>`;
    })
    .join("");

  const actionUrl = resolveAppUrl("/admin/pay-adjustments");
  const html = `
    <div style="font-family:Arial,sans-serif;color:#111;">
      <h2 style="margin:0 0 8px;">${pending.length} extra-pay request${pending.length === 1 ? "" : "s"} awaiting your approval</h2>
      <p style="color:#555;margin:0 0 12px;">These have been pending for more than ${AGING_HOURS} hours. Total requested: <strong>${money(totalAmount)}</strong>. Approving affects what cleaners can invoice.</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #ddd;">Cleaner</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #ddd;">For</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #ddd;">Requested</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #ddd;">Waiting</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <p style="margin:16px 0;">
        <a href="${actionUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;">Review pay requests</a>
      </p>
    </div>`;

  const settings = await getAppSettings();
  const subject = `${settings.companyName}: ${pending.length} extra-pay request${pending.length === 1 ? "" : "s"} awaiting approval`;

  const admins = await db.user.findMany({
    where: { role: { in: ["ADMIN", "OPS_MANAGER"] }, isActive: true },
    select: { id: true, role: true, email: true, phone: true, name: true },
  });

  // Route through the notification system so per-admin channel preferences are
  // honoured, Notification rows are written (visible in the feed + the
  // "failed notifications" health tile), rather than a raw email bypass.
  const summaryLine = `${pending.length} extra-pay request${pending.length === 1 ? "" : "s"} awaiting approval — ${money(totalAmount)} total.`;
  await deliverNotificationToRecipients({
    recipients: admins.map((a) => ({ id: a.id, role: a.role, email: a.email, phone: a.phone, name: a.name })),
    category: "approvals",
    url: actionUrl,
    web: { subject, body: summaryLine },
    email: { subject, html },
  });
  const sent = admins.filter((a) => a.email).length;

  if (!options.ignoreWindow) await markSentToday(dateKey);
  logger.info({ pending: pending.length, sent, totalAmount }, "Pending pay-approval reminders dispatched");
  return { sent, pending: pending.length, skipped: null };
}
