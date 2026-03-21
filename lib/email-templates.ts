import { resolveAppUrl } from "@/lib/app-url";

export type AppEmailTemplateKey =
  | "signupOtp"
  | "resetPassword"
  | "welcomeAccount"
  | "jobAssigned"
  | "jobRemoved"
  | "laundryReady"
  | "cleaningReportShared"
  | "laundryReport"
  | "cleanerInvoice"
  | "lostFoundAlert"
  | "extraPayRequest";

export interface EmailTemplateConfig {
  subject: string;
  html: string;
}

export type AppEmailTemplates = Record<AppEmailTemplateKey, EmailTemplateConfig>;

export const EMAIL_TEMPLATE_KEYS: AppEmailTemplateKey[] = [
  "signupOtp",
  "resetPassword",
  "welcomeAccount",
  "jobAssigned",
  "jobRemoved",
  "laundryReady",
  "cleaningReportShared",
  "laundryReport",
  "cleanerInvoice",
  "lostFoundAlert",
  "extraPayRequest",
];

export const EMAIL_TEMPLATE_DEFINITIONS: Record<
  AppEmailTemplateKey,
  { label: string; variables: string[] }
> = {
  signupOtp: {
    label: "Signup OTP",
    variables: ["companyName", "logoUrl", "code", "expiryMinutes", "email", "actionUrl", "actionLabel"],
  },
  resetPassword: {
    label: "Reset Password",
    variables: ["companyName", "logoUrl", "userName", "tempPassword", "email", "actionUrl", "actionLabel"],
  },
  welcomeAccount: {
    label: "Welcome Account",
    variables: ["companyName", "logoUrl", "userName", "role", "email", "tempPassword", "welcomeNote", "actionUrl", "actionLabel"],
  },
  jobAssigned: {
    label: "Job Assigned",
    variables: ["companyName", "logoUrl", "jobType", "propertyName", "when", "timingFlags", "jobNumber", "jobUrl", "userName", "actionUrl", "actionLabel"],
  },
  jobRemoved: {
    label: "Job Removed",
    variables: ["companyName", "logoUrl", "jobType", "propertyName", "when", "timingFlags", "jobNumber", "jobUrl", "userName", "actionUrl", "actionLabel"],
  },
  laundryReady: {
    label: "Laundry Ready",
    variables: [
      "companyName",
      "logoUrl",
      "propertyName",
      "jobNumber",
      "cleanDate",
      "bagLocation",
      "laundryPhotoUrl",
      "portalUrl",
      "actionUrl",
      "actionLabel",
    ],
  },
  cleaningReportShared: {
    label: "Cleaning Report Shared",
    variables: [
      "companyName",
      "logoUrl",
      "clientName",
      "jobNumber",
      "propertyName",
      "jobType",
      "cleanDate",
      "reportLink",
      "actionUrl",
      "actionLabel",
    ],
  },
  laundryReport: {
    label: "Laundry Report",
    variables: ["companyName", "logoUrl", "recipientName", "reportLabel", "propertyName", "actionUrl", "actionLabel"],
  },
  cleanerInvoice: {
    label: "Cleaner Invoice",
    variables: ["companyName", "logoUrl", "cleanerName", "accountsEmail", "jobCount", "actionUrl", "actionLabel"],
  },
  lostFoundAlert: {
    label: "Lost & Found Alert",
    variables: ["companyName", "logoUrl", "cleanerName", "propertyName", "itemName", "location", "notes", "caseLink", "actionUrl", "actionLabel"],
  },
  extraPayRequest: {
    label: "Extra Pay Request",
    variables: ["companyName", "logoUrl", "cleanerName", "propertyName", "jobType", "jobNumber", "requestType", "requestedAmount", "cleanerNote", "actionUrl", "actionLabel"],
  },
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: unknown) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function normalizeTemplateVariables(variables: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(variables).map(([name, rawValue]) => {
      const value = String(rawValue ?? "").trim();
      if (/(url|link)$/i.test(name) && value.startsWith("/")) {
        return [name, resolveAppUrl(value)];
      }
      return [name, value];
    })
  ) as Record<string, string>;
}

function inferActionLink(variables: Record<string, string>) {
  const candidates: Array<{ url: string; label: string }> = [
    { url: variables.actionUrl ?? "", label: variables.actionLabel ?? "Open details" },
    { url: variables.jobUrl ?? "", label: "Open job" },
    { url: variables.reportLink ?? "", label: "Open report" },
    { url: variables.caseLink ?? "", label: "Open case" },
    { url: variables.approvalUrl ?? "", label: "Review request" },
    { url: variables.quoteUrl ?? "", label: "Open quote" },
    { url: variables.portalUrl ?? "", label: "Open portal" },
    { url: variables.loginUrl ?? "", label: "Sign in" },
  ];

  for (const candidate of candidates) {
    const url = (candidate.url ?? "").trim();
    if (!url) continue;
    if (/^(https?:\/\/|mailto:|tel:)/i.test(url)) {
      return { url, label: candidate.label || "Open details" };
    }
  }

  return null;
}

export function getDefaultEmailTemplates(): AppEmailTemplates {
  return {
    signupOtp: {
      subject: "Verify your {companyName} account",
      html: `
        <h2 style="margin:0 0 12px;">Verify your email address</h2>
        <p>Please use the one-time code below to complete your account verification.</p>
        <div style="margin:18px 0;padding:16px 18px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;text-align:center;">
          <div style="font-size:30px;font-weight:800;letter-spacing:0.24em;">{code}</div>
        </div>
        <p><strong>Valid for:</strong> {expiryMinutes} minutes</p>
        <p>If you did not request this email, you can ignore it safely.</p>
      `,
    },
    resetPassword: {
      subject: "Your temporary {companyName} password",
      html: `
        <h2 style="margin:0 0 12px;">Temporary password issued</h2>
        <p>Hello {userName},</p>
        <p>An administrator reset your password. Use the temporary password below, then change it immediately after signing in.</p>
        <div style="margin:18px 0;padding:16px 18px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
          <div style="font-size:24px;font-weight:800;letter-spacing:0.08em;">{tempPassword}</div>
        </div>
        <p><strong>Account:</strong> {email}</p>
      `,
    },
    welcomeAccount: {
      subject: "Welcome to {companyName}",
      html: `
        <h2 style="margin:0 0 12px;">Welcome, {userName}</h2>
        <p>Your account has been activated and is ready to use.</p>
        <p><strong>Portal role:</strong> {role}</p>
        <p><strong>Login email:</strong> {email}</p>
        <p><strong>Temporary password:</strong> {tempPassword}</p>
        <p>{welcomeNote}</p>
        <p>Complete your profile details after signing in so notifications, invoices, and approvals keep working correctly.</p>
      `,
    },
    jobAssigned: {
      subject: "{companyName}: Job assignment updated ({jobNumber})",
      html: `
        <h2 style="margin:0 0 12px;">Job assignment updated</h2>
        <p>Hello {userName},</p>
        <p>You have been assigned to <strong>{jobType}</strong> at <strong>{propertyName}</strong>.</p>
        <p><strong>Job number:</strong> {jobNumber}</p>
        <p><strong>Scheduled:</strong> {when}</p>
        <p><strong>Timing notes:</strong> {timingFlags}</p>
      `,
    },
    jobRemoved: {
      subject: "{companyName}: Job removed from your schedule ({jobNumber})",
      html: `
        <h2 style="margin:0 0 12px;">Job removed from schedule</h2>
        <p>Hello {userName},</p>
        <p>You have been removed from <strong>{jobType}</strong> at <strong>{propertyName}</strong>.</p>
        <p><strong>Job number:</strong> {jobNumber}</p>
        <p><strong>Scheduled:</strong> {when}</p>
        <p><strong>Timing notes:</strong> {timingFlags}</p>
      `,
    },
    laundryReady: {
      subject: "{companyName}: Laundry ready for pickup - {propertyName} ({jobNumber})",
      html: `
        <h2 style="margin:0 0 12px;">Laundry ready for pickup</h2>
        <p>The cleaner has confirmed that laundry is ready for collection.</p>
        <div style="margin:18px 0;padding:16px 18px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
          <p style="margin:0 0 6px;"><strong>Job number:</strong> {jobNumber}</p>
          <p style="margin:0 0 6px;"><strong>Property:</strong> {propertyName}</p>
          <p style="margin:0 0 6px;"><strong>Clean date:</strong> {cleanDate}</p>
          <p style="margin:0;"><strong>Bag location:</strong> {bagLocation}</p>
        </div>
        <p><a href="{laundryPhotoUrl}" target="_blank" rel="noopener noreferrer">View laundry photo</a></p>
      `,
    },
    cleaningReportShared: {
      subject: "{companyName} report for {propertyName} - {cleanDate} ({jobNumber})",
      html: `
        <h2 style="margin:0 0 12px;">Cleaning report ready</h2>
        <p>Hello {clientName},</p>
        <p>Your <strong>{jobType}</strong> report for <strong>{propertyName}</strong> is ready.</p>
        <div style="margin:18px 0;padding:16px 18px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
          <p style="margin:0 0 6px;"><strong>Job number:</strong> {jobNumber}</p>
          <p style="margin:0 0 6px;"><strong>Cleaned date:</strong> {cleanDate}</p>
          <p style="margin:0;"><strong>Property:</strong> {propertyName}</p>
        </div>
        <p>The PDF report is attached to this email. You can also open the client portal from the button below to review your latest service history.</p>
      `,
    },
    laundryReport: {
      subject: "{companyName} - Laundry Report - {reportLabel}",
      html: `
        <h2 style="margin:0 0 12px;">Laundry report attached</h2>
        <p>Hello {recipientName},</p>
        <p>Please find the attached laundry report for <strong>{reportLabel}</strong>.</p>
        <p><strong>Property:</strong> {propertyName}</p>
      `,
    },
    cleanerInvoice: {
      subject: "{companyName} - Cleaner Invoice {cleanerName}",
      html: `
        <h2 style="margin:0 0 12px;">Cleaner invoice attached</h2>
        <p>Hello,</p>
        <p>Please find the attached cleaner invoice for <strong>{cleanerName}</strong>.</p>
        <p><strong>Total jobs included:</strong> {jobCount}</p>
      `,
    },
    lostFoundAlert: {
      subject: "{companyName} - Lost & Found Case Opened",
      html: `
        <h2 style="margin:0 0 12px;">Lost and found case opened</h2>
        <p>A new lost and found case has been submitted by <strong>{cleanerName}</strong>.</p>
        <p><strong>Property:</strong> {propertyName}</p>
        <p><strong>Item:</strong> {itemName}</p>
        <p><strong>Location found:</strong> {location}</p>
        <p><strong>Notes:</strong> {notes}</p>
      `,
    },
    extraPayRequest: {
      subject: "{companyName} - Extra Payment Request - {propertyName} ({jobNumber})",
      html: `
        <h2 style="margin:0 0 12px;">Extra payment request submitted</h2>
        <p><strong>Cleaner:</strong> {cleanerName}</p>
        <p><strong>Property:</strong> {propertyName}</p>
        <p><strong>Job number:</strong> {jobNumber}</p>
        <p><strong>Job:</strong> {jobType}</p>
        <p><strong>Request type:</strong> {requestType}</p>
        <p><strong>Requested amount:</strong> {requestedAmount}</p>
        <p><strong>Cleaner note:</strong> {cleanerNote}</p>
      `,
    },
  };
}

export function sanitizeEmailTemplates(input: unknown, fallback: AppEmailTemplates): AppEmailTemplates {
  if (!input || typeof input !== "object") return fallback;
  const parsed = input as Record<string, unknown>;
  const next = { ...fallback };

  for (const key of EMAIL_TEMPLATE_KEYS) {
    const row = parsed[key];
    if (!row || typeof row !== "object") continue;
    const value = row as Record<string, unknown>;
    next[key] = {
      subject:
        typeof value.subject === "string" && value.subject.trim()
          ? value.subject.trim()
          : fallback[key].subject,
      html:
        typeof value.html === "string" && value.html.trim()
          ? value.html.trim()
          : fallback[key].html,
    };
  }

  return next;
}

export function wrapEmailHtml(settings: { companyName: string; logoUrl: string }, innerHtml: string, actionLink?: { url: string; label: string } | null) {
  const logoHtml = settings.logoUrl
    ? `<img src="${escapeAttribute(settings.logoUrl)}" alt="${escapeHtml(settings.companyName)}" style="max-height:56px;max-width:220px;display:block;height:auto;width:auto;" />`
    : "";

  const actionButtonHtml = actionLink
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 8px 0;">
        <tr>
          <td style="border-radius:12px;background:#0f766e;">
            <a href="${escapeAttribute(actionLink.url)}" target="_blank" rel="noopener noreferrer"
              style="display:inline-block;padding:12px 18px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">
              ${escapeHtml(actionLink.label)}
            </a>
          </td>
        </tr>
      </table>
    `
    : "";

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>
        @media only screen and (max-width: 620px) {
          .container { width: 100% !important; }
          .content { padding: 18px !important; }
          .brand { font-size: 18px !important; }
          .body-copy { font-size: 14px !important; }
        }
      </style>
    </head>
    <body style="margin:0;padding:18px;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td align="center">
            <table role="presentation" class="container" width="680" cellpadding="0" cellspacing="0" border="0"
              style="width:680px;max-width:100%;background:#ffffff;border:1px solid #dbe3ee;border-radius:18px;overflow:hidden;box-shadow:0 18px 50px rgba(15,23,42,0.08);">
              <tr>
                <td style="padding:20px 24px;background:linear-gradient(135deg,#0f766e,#155e75);color:#ffffff;">
                  ${logoHtml || `<div style="font-size:22px;font-weight:800;letter-spacing:0.02em;">${escapeHtml(settings.companyName)}</div>`}
                  <div class="brand" style="font-size:20px;font-weight:700;line-height:1.25;margin-top:${logoHtml ? "12px" : "8px"};">
                    ${escapeHtml(settings.companyName)}
                  </div>
                </td>
              </tr>
              <tr>
                <td class="content" style="padding:24px;">
                  <div class="body-copy" style="font-size:15px;line-height:1.7;color:#0f172a;">
                    ${innerHtml}
                  </div>
                  ${actionButtonHtml}
                  <div style="margin-top:22px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#64748b;line-height:1.6;">
                    ${escapeHtml(settings.companyName)}<br />
                    This is an automated email from your operations dashboard.
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>`;
}

export function renderEmailTemplate(
  settings: { companyName: string; logoUrl: string; emailTemplates: AppEmailTemplates },
  key: AppEmailTemplateKey,
  variables: Record<string, unknown>
) {
  const template = settings.emailTemplates[key] ?? getDefaultEmailTemplates()[key];
  const mergedVariables = normalizeTemplateVariables({
    companyName: settings.companyName,
    logoUrl: settings.logoUrl,
    ...Object.fromEntries(Object.entries(variables).map(([name, value]) => [name, String(value ?? "")])),
  });

  const replaceVariables = (value: string) =>
    value.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name: string) => mergedVariables[name] ?? "");

  const subject = replaceVariables(template.subject);
  const innerHtml = replaceVariables(template.html);
  const actionLink = inferActionLink(mergedVariables);
  const shouldRenderActionButton = actionLink && !innerHtml.includes(actionLink.url);

  const html = wrapEmailHtml(
    settings,
    innerHtml,
    shouldRenderActionButton ? actionLink : null
  );

  return { subject, html };
}
