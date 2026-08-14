/**
 * CP-6 — the "you've been assigned maintenance work" email.
 *
 * Pure: it takes already-formatted strings and returns `{ subject, html }`, the
 * same shape `renderEmailTemplate` and `buildBulkAssignedEmail` return, so it
 * drops straight into `sendEmailDetailed`. Dates are formatted by the CALLER in
 * Australia/Sydney — keeping the clock out of here is what makes it testable.
 */
import { wrapEmailHtml } from "@/lib/email-templates";

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
  params: MaintenanceAssignedEmailParams
): { subject: string; html: string } {
  const companyName = settings.companyName || "sNeek Property Services";

  const rows = [
    row("Property", params.propertyName),
    row("Your role", params.roleLabel),
    row("Priority", params.priorityLabel),
    row("Scheduled", params.scheduledFor ?? "Not scheduled yet"),
  ].join("");

  const innerHtml = `<h2 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:600;color:#2f2b28;line-height:1.25;">You've been assigned to a maintenance item</h2>
<p style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:14.5px;color:#2f2b28;">Hello ${escapeHtml(
    params.userName
  )}, you have been added to the following maintenance item as <strong>${escapeHtml(
    params.roleLabel
  )}</strong>. It now appears in your portal.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:12px 0;background:#faf8f5;border:1px solid #e6e1da;border-radius:14px;">
  <tr>
    <td style="padding:16px 20px;">
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:18px;font-weight:600;color:#2f2b28;line-height:1.3;">${escapeHtml(
        params.itemTitle
      )}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:10px;">${rows}</table>
    </td>
  </tr>
</table>
<p style="margin:18px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#8a8580;">Other people may be assigned to this item in other roles. Please coordinate before attending.</p>`;

  const actionLink =
    params.actionUrl && /^https?:\/\//i.test(params.actionUrl.trim())
      ? { url: params.actionUrl.trim(), label: "Open maintenance item" }
      : null;

  return {
    subject: `Maintenance assigned — ${params.itemTitle} (${params.propertyName}) · ${companyName}`,
    html: wrapEmailHtml(settings, innerHtml, actionLink),
  };
}
