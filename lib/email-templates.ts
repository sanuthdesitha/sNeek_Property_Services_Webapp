export type AppEmailTemplateKey =
  | "signupOtp"
  | "resetPassword"
  | "welcomeAccount"
  | "jobAssigned"
  | "jobRemoved"
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
    variables: ["companyName", "logoUrl", "userName", "role", "actionUrl", "actionLabel"],
  },
  jobAssigned: {
    label: "Job Assigned",
    variables: ["companyName", "logoUrl", "jobType", "propertyName", "when", "timingFlags", "jobUrl", "userName", "actionUrl", "actionLabel"],
  },
  jobRemoved: {
    label: "Job Removed",
    variables: ["companyName", "logoUrl", "jobType", "propertyName", "when", "timingFlags", "jobUrl", "userName", "actionUrl", "actionLabel"],
  },
  cleaningReportShared: {
    label: "Cleaning Report Shared",
    variables: ["companyName", "logoUrl", "clientName", "propertyName", "reportLink", "actionUrl", "actionLabel"],
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
    variables: ["companyName", "logoUrl", "cleanerName", "propertyName", "jobType", "requestType", "requestedAmount", "cleanerNote", "actionUrl", "actionLabel"],
  },
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: unknown) {
  return escapeHtml(value).replace(/`/g, "&#96;");
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
    if (/^(https?:\/\/|mailto:|tel:|\/)/i.test(url)) {
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
        <h2>Verify your email</h2>
        <p>Your one-time code is:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:0.2em;">{code}</p>
        <p>This code expires in {expiryMinutes} minutes.</p>
        <p>If you did not request this, please ignore this email.</p>
      `,
    },
    resetPassword: {
      subject: "Your temporary {companyName} password",
      html: `
        <h2>Password reset</h2>
        <p>Hello {userName},</p>
        <p>An administrator reset your password.</p>
        <p>Your temporary password is:</p>
        <p style="font-size:24px;font-weight:700;letter-spacing:0.08em;">{tempPassword}</p>
        <p>Please sign in with this password and change it immediately from your settings.</p>
      `,
    },
    welcomeAccount: {
      subject: "Welcome to {companyName}",
      html: `
        <h2>Welcome, {userName}</h2>
        <p>Your account has been verified and activated.</p>
        <p><strong>Role:</strong> {role}</p>
        <p>Sign in to complete your onboarding details and start using the portal.</p>
      `,
    },
    jobAssigned: {
      subject: "{companyName}: Job assignment updated",
      html: `
        <p>Hello {userName},</p>
        <p>You have been assigned to <strong>{jobType}</strong> at <strong>{propertyName}</strong>.</p>
        <p><strong>When:</strong> {when}</p>
        <p><strong>Timing:</strong> {timingFlags}</p>
        <p><a href="{jobUrl}">Open job details</a></p>
      `,
    },
    jobRemoved: {
      subject: "{companyName}: Job removed from your schedule",
      html: `
        <p>Hello {userName},</p>
        <p>You have been removed from <strong>{jobType}</strong> at <strong>{propertyName}</strong>.</p>
        <p><strong>When:</strong> {when}</p>
        <p><strong>Timing:</strong> {timingFlags}</p>
        <p><a href="{jobUrl}">Open job details</a></p>
      `,
    },
    cleaningReportShared: {
      subject: "{companyName} - Cleaning Report - {propertyName}",
      html: `
        <p>Hello {clientName},</p>
        <p>Your cleaning report is ready for <strong>{propertyName}</strong>.</p>
        <p><a href="{reportLink}">Download report</a></p>
      `,
    },
    laundryReport: {
      subject: "{companyName} - Laundry Report - {reportLabel}",
      html: `
        <p>Hello {recipientName},</p>
        <p>Please find the laundry report attached for <strong>{reportLabel}</strong>.</p>
        <p>This email includes the PDF copy for processing.</p>
      `,
    },
    cleanerInvoice: {
      subject: "{companyName} - Cleaner Invoice {cleanerName}",
      html: `
        <p>Hello,</p>
        <p>Please find the attached cleaner invoice for <strong>{cleanerName}</strong>.</p>
        <p>Total jobs included: <strong>{jobCount}</strong>.</p>
      `,
    },
    lostFoundAlert: {
      subject: "{companyName} - Lost & Found Case Opened",
      html: `
        <p>A new lost &amp; found case has been submitted by <strong>{cleanerName}</strong>.</p>
        <p><strong>Property:</strong> {propertyName}</p>
        <p><strong>Item:</strong> {itemName}</p>
        <p><strong>Location Found:</strong> {location}</p>
        <p><strong>Notes:</strong> {notes}</p>
        <p><a href="{caseLink}">Open Lost &amp; Found Cases</a></p>
      `,
    },
    extraPayRequest: {
      subject: "{companyName} - Extra Payment Request - {propertyName}",
      html: `
        <p>{cleanerName} submitted an extra payment request.</p>
        <p><strong>Property:</strong> {propertyName}</p>
        <p><strong>Job:</strong> {jobType}</p>
        <p><strong>Type:</strong> {requestType}</p>
        <p><strong>Requested:</strong> {requestedAmount}</p>
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

export function renderEmailTemplate(
  settings: { companyName: string; logoUrl: string; emailTemplates: AppEmailTemplates },
  key: AppEmailTemplateKey,
  variables: Record<string, unknown>
) {
  const template = settings.emailTemplates[key] ?? getDefaultEmailTemplates()[key];
  const mergedVariables: Record<string, string> = {
    companyName: settings.companyName,
    logoUrl: settings.logoUrl,
    ...Object.fromEntries(
      Object.entries(variables).map(([name, value]) => [name, String(value ?? "")])
    ),
  };

  const replaceVariables = (value: string) =>
    value.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name: string) => mergedVariables[name] ?? "");

  const subject = replaceVariables(template.subject);
  const innerHtml = replaceVariables(template.html);
  const actionLink = inferActionLink(mergedVariables);
  const shouldRenderActionButton = actionLink && !innerHtml.includes(actionLink.url);
  const logoHtml = settings.logoUrl
    ? `<img src="${escapeAttribute(settings.logoUrl)}" alt="${escapeHtml(settings.companyName)}" style="max-height:56px;max-width:220px;display:block;height:auto;width:auto;margin-bottom:12px;" />`
    : "";

  const actionButtonHtml = shouldRenderActionButton
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 8px 0;">
        <tr>
          <td style="border-radius:10px;background:#0f766e;">
            <a href="${escapeAttribute(actionLink.url)}" target="_blank" rel="noopener noreferrer"
              style="display:inline-block;padding:12px 18px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">
              ${escapeHtml(actionLink.label)}
            </a>
          </td>
        </tr>
      </table>
    `
    : "";

  const html = `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>
        @media only screen and (max-width: 620px) {
          .container { width: 100% !important; }
          .content { padding: 16px !important; }
          .brand { font-size: 18px !important; }
          .body-copy { font-size: 14px !important; }
        }
      </style>
    </head>
    <body style="margin:0;padding:16px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td align="center">
            <table role="presentation" class="container" width="680" cellpadding="0" cellspacing="0" border="0"
              style="width:680px;max-width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;">
              <tr>
                <td class="content" style="padding:24px;">
                  ${logoHtml}
                  <div class="brand" style="font-size:20px;font-weight:700;line-height:1.25;margin-bottom:14px;">
                    ${escapeHtml(settings.companyName)}
                  </div>
                  <div class="body-copy" style="font-size:15px;line-height:1.6;">
                    ${innerHtml}
                  </div>
                  ${actionButtonHtml}
                  <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">
                    ${escapeHtml(settings.companyName)} - This is an automated message.
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>`;

  return { subject, html };
}
