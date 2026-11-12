/**
 * CP-6 — the "you've been assigned maintenance work" email.
 *
 * Pure: it takes already-formatted strings and returns `{ subject, html }`, the
 * same shape `renderEmailTemplate` and `buildBulkAssignedEmail` return, so it
 * drops straight into `sendEmailDetailed`. Dates are formatted by the CALLER in
 * Australia/Sydney — keeping the clock out of here is what makes it testable.
 */
import { wrapEmailHtml } from "@/lib/email-templates";
import { defaultNotificationWording, type WordingRenderer } from "@/lib/notifications/wording/render";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface MaintenanceAssignedEmailParams {
  /** Who is being told. */
  userName: string;
  /** Which hat they are wearing, e.g. "Cleaner" — see MAINTENANCE_ASSIGNEE_ROLE_LABELS. */
  roleLabel: string;
  itemTitle: string;
  propertyName: string;
  priorityLabel: string;
  /** Pre-formatted Sydney-local time, or null when nothing is scheduled yet. */
  scheduledFor: string | null;
  /** Absolute URL to the item in the person's own portal. */
  actionUrl?: string | null;
}

const LABEL_STYLE =
  "font-family:Helvetica,Arial,sans-serif;font-size:10.5px;font-weight:700;color:#8a8580;text-transform:uppercase;letter-spacing:0.14em;";
const VALUE_STYLE = "font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#2f2b28;";

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;${LABEL_STYLE}width:150px;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:6px 0;${VALUE_STYLE}">${escapeHtml(value)}</td>
  </tr>`;
}

export function buildMaintenanceAssignedEmail(
  settings: { companyName: string; logoUrl: string },
  params: MaintenanceAssignedEmailParams,
  wording: WordingRenderer = defaultNotificationWording("maintenance.assignment")
): { subject: string; html: string } {
  const companyName = settings.companyName || "sNeek Property Services";

  const rows = [
    row("Property", params.propertyName),
    row("Your role", params.roleLabel),
    row("Priority", params.priorityLabel),
    row("Scheduled", params.scheduledFor ?? wording.line("not-scheduled", "EMAIL", {})),
  ].join("");

  const email = wording.render("assigned", "EMAIL", {
    userName: params.userName,
    roleLabel: params.roleLabel,
    itemTitle: params.itemTitle,
    propertyName: params.propertyName,
    companyName,
    detailRows: rows,
  });
  const innerHtml = email.html;

  const actionLink =
    params.actionUrl && /^https?:\/\//i.test(params.actionUrl.trim())
      ? { url: params.actionUrl.trim(), label: wording.line("open-button", "EMAIL", {}) }
      : null;

  return {
    subject: email.subject,
    html: wrapEmailHtml(settings, innerHtml, actionLink),
  };
}
