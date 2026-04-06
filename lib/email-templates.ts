import { resolveAppUrl } from "@/lib/app-url";

export type AppEmailTemplateKey =
  | "signupOtp"
  | "resetPassword"
  | "welcomeAccount"
  | "accountInvite"
  | "newProfileCreated"
  | "jobReminder24h"
  | "jobAssigned"
  | "jobRemoved"
  | "laundryReady"
  | "laundrySkipRequested"
  | "laundrySkipApproved"
  | "cleaningReportShared"
  | "reportVisibilityChanged"
  | "laundryReport"
  | "cleanerInvoice"
  | "clientInvoiceIssued"
  | "lostFoundAlert"
  | "extraPayRequest"
  | "caseCreated"
  | "caseUpdated"
  | "shoppingRunSubmitted"
  | "shoppingReimbursementToClient"
  | "stockRunRequested"
  | "stockRunSubmitted"
  | "adminAttentionSummary"
  | "tomorrowJobsSummary"
  | "tomorrowLaundrySummary"
  | "criticalInventoryTomorrow"
  | "quoteApprovalRequest"
  | "quoteSentToClient";

export interface EmailTemplateConfig {
  subject: string;
  html: string;
}

export type AppEmailTemplates = Record<AppEmailTemplateKey, EmailTemplateConfig>;

export const COMMON_EMAIL_TEMPLATE_VARIABLES = [
  "companyName",
  "projectName",
  "logoUrl",
  "accountsEmail",
  "supportEmail",
  "timezone",
  "appUrl",
  "portalUrl",
  "loginUrl",
  "adminUrl",
  "cleanerUrl",
  "clientUrl",
  "laundryUrl",
  "jobsUrl",
  "reportsUrl",
  "settingsUrl",
  "currentDate",
  "currentTime",
  "currentDateTime",
  "currentDateIso",
  "currentDateTimeIso",
  "currentYear",
  "actionUrl",
  "actionLabel",
] as const;

export const EMAIL_TEMPLATE_KEYS: AppEmailTemplateKey[] = [
  "signupOtp",
  "resetPassword",
  "welcomeAccount",
  "accountInvite",
  "newProfileCreated",
  "jobReminder24h",
  "jobAssigned",
  "jobRemoved",
  "laundryReady",
  "laundrySkipRequested",
  "laundrySkipApproved",
  "cleaningReportShared",
  "reportVisibilityChanged",
  "laundryReport",
  "cleanerInvoice",
  "clientInvoiceIssued",
  "lostFoundAlert",
  "extraPayRequest",
  "caseCreated",
  "caseUpdated",
  "shoppingRunSubmitted",
  "shoppingReimbursementToClient",
  "stockRunRequested",
  "stockRunSubmitted",
  "adminAttentionSummary",
  "tomorrowJobsSummary",
  "tomorrowLaundrySummary",
  "criticalInventoryTomorrow",
  "quoteApprovalRequest",
  "quoteSentToClient",
];

function mergeTemplateVariableLists(...lists: ReadonlyArray<ReadonlyArray<string>>) {
  return Array.from(new Set(lists.flatMap((list) => list)));
}

const EMAIL_TEMPLATE_DEFINITIONS_BASE: Record<
  AppEmailTemplateKey,
  { label: string; variables: string[] }
> = {
  signupOtp: {
    label: "Signup OTP",
    variables: ["code", "expiryMinutes", "email"],
  },
  resetPassword: {
    label: "Reset Password",
    variables: ["userName", "tempPassword", "email"],
  },
  welcomeAccount: {
    label: "Welcome Account",
    variables: ["userName", "role", "email", "tempPassword", "welcomeNote"],
  },
  accountInvite: {
    label: "Account Invite",
    variables: ["userName", "role", "email", "tempPassword", "welcomeNote"],
  },
  newProfileCreated: {
    label: "New Profile Created",
    variables: ["userName", "role", "email", "createdVia", "createdAt"],
  },
  jobReminder24h: {
    label: "24h Job Reminder",
    variables: [
      "userName",
      "jobType",
      "propertyName",
      "propertyAddress",
      "when",
      "timingFlags",
      "jobNumber",
      "jobUrl",
    ],
  },
  jobAssigned: {
    label: "Job Assigned",
    variables: ["jobType", "propertyName", "when", "timingFlags", "jobNumber", "jobUrl", "userName"],
  },
  jobRemoved: {
    label: "Job Removed",
    variables: ["jobType", "propertyName", "when", "timingFlags", "jobNumber", "jobUrl", "userName"],
  },
  laundryReady: {
    label: "Laundry Ready",
    variables: [
      "propertyName",
      "jobNumber",
      "cleanDate",
      "scheduledPickupDate",
      "scheduledDropoffDate",
      "bagLocation",
      "laundryPhotoUrl",
    ],
  },
  laundrySkipRequested: {
    label: "Laundry Skip Requested",
    variables: [
      "propertyName",
      "jobNumber",
      "cleanDate",
      "laundryOutcome",
      "reasonCode",
      "reasonNote",
    ],
  },
  laundrySkipApproved: {
    label: "Laundry Skip Approved",
    variables: [
      "propertyName",
      "jobNumber",
      "cleanDate",
      "decision",
      "reasonNote",
    ],
  },
  cleaningReportShared: {
    label: "Cleaning Report Shared",
    variables: [
      "clientName",
      "jobNumber",
      "propertyName",
      "jobType",
      "cleanDate",
      "reportLink",
    ],
  },
  reportVisibilityChanged: {
    label: "Report Visibility Changed",
    variables: [
      "propertyName",
      "jobNumber",
      "visibilityAudience",
      "visibilityState",
      "visibilityNote",
    ],
  },
  laundryReport: {
    label: "Laundry Report",
    variables: ["recipientName", "reportLabel", "propertyName"],
  },
  cleanerInvoice: {
    label: "Cleaner Invoice",
    variables: ["cleanerName", "jobCount"],
  },
  clientInvoiceIssued: {
    label: "Client Invoice Issued",
    variables: [
      "clientName",
      "invoiceNumber",
      "periodLabel",
      "totalAmount",
    ],
  },
  lostFoundAlert: {
    label: "Lost & Found Alert",
    variables: ["cleanerName", "propertyName", "itemName", "location", "notes", "caseLink"],
  },
  extraPayRequest: {
    label: "Extra Pay Request",
    variables: ["cleanerName", "propertyName", "jobType", "jobNumber", "requestType", "requestedAmount", "cleanerNote"],
  },
  caseCreated: {
    label: "Case Created",
    variables: [
      "caseTitle",
      "caseType",
      "propertyName",
      "jobNumber",
      "status",
      "priority",
    ],
  },
  caseUpdated: {
    label: "Case Updated",
    variables: [
      "caseTitle",
      "caseType",
      "status",
      "updateNote",
    ],
  },
  shoppingRunSubmitted: {
    label: "Shopping Run Submitted",
    variables: [
      "runTitle",
      "submittedBy",
      "paidBy",
      "actualAmount",
      "propertyNames",
    ],
  },
  shoppingReimbursementToClient: {
    label: "Shopping Reimbursement To Client",
    variables: [
      "clientName",
      "runTitle",
      "actualAmount",
      "propertyNames",
    ],
  },
  stockRunRequested: {
    label: "Stock Run Requested",
    variables: [
      "propertyName",
      "requestedBy",
    ],
  },
  stockRunSubmitted: {
    label: "Stock Run Submitted",
    variables: [
      "propertyName",
      "submittedBy",
      "lineCount",
    ],
  },
  adminAttentionSummary: {
    label: "Admin Attention Summary",
    variables: [
      "recipientName",
      "dateLabel",
      "attentionCount",
      "approvalCount",
      "pendingPayRequests",
      "pendingTimeAdjustments",
      "pendingContinuations",
      "pendingClientApprovals",
      "pendingLaundryRescheduleDraft",
      "unassignedJobCount",
      "openCaseCount",
      "overdueCaseCount",
      "highCaseCount",
      "newCaseCount",
      "flaggedLaundryCount",
      "breakdownHtml",
      "breakdownText",
    ],
  },
  tomorrowJobsSummary: {
    label: "Tomorrow Jobs Summary",
    variables: [
      "recipientName",
      "roleLabel",
      "dateLabel",
      "jobCount",
      "summaryHtml",
      "summaryText",
    ],
  },
  tomorrowLaundrySummary: {
    label: "Tomorrow Laundry Summary",
    variables: [
      "recipientName",
      "dateLabel",
      "taskCount",
      "summaryHtml",
      "summaryText",
    ],
  },
  criticalInventoryTomorrow: {
    label: "Critical Inventory Tomorrow",
    variables: [
      "recipientName",
      "roleLabel",
      "dateLabel",
      "propertyCount",
      "itemCount",
      "inventoryHtml",
      "inventoryText",
    ],
  },
  quoteApprovalRequest: {
    label: "Quote Approval Request",
    variables: [
      "clientName",
      "serviceType",
      "quoteTotal",
    ],
  },
  quoteSentToClient: {
    label: "Quote Sent To Client",
    variables: [
      "clientName",
      "serviceType",
      "quoteTotal",
      "validUntil",
    ],
  },
};

export const EMAIL_TEMPLATE_DEFINITIONS: Record<
  AppEmailTemplateKey,
  { label: string; variables: string[] }
> = Object.fromEntries(
  Object.entries(EMAIL_TEMPLATE_DEFINITIONS_BASE).map(([key, definition]) => [
    key,
    {
      ...definition,
      variables: mergeTemplateVariableLists(COMMON_EMAIL_TEMPLATE_VARIABLES, definition.variables),
    },
  ])
) as Record<AppEmailTemplateKey, { label: string; variables: string[] }>;

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

function infoBox(...rows: [string, string][]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;margin:20px 0;">${rows.map(([label, val], i) => `<tr style="background:${i % 2 === 0 ? "#f9fafb" : "#ffffff"};"><td style="padding:10px 16px;font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;width:38%;vertical-align:top;">${label}</td><td style="padding:10px 16px;font-size:13.5px;color:#111827;vertical-align:top;">${val}</td></tr>`).join("")}</table>`;
}

function alertBox(message: string, variant: "warning" | "success" | "info" = "info"): string {
  const colors: Record<string, { bg: string; border: string; text: string }> = {
    warning: { bg: "#fffbeb", border: "#fcd34d", text: "#92400e" },
    success: { bg: "#f0fdf4", border: "#86efac", text: "#14532d" },
    info:    { bg: "#eff6ff", border: "#93c5fd", text: "#1e3a5f" },
  };
  const c = colors[variant];
  return `<div style="margin:16px 0;padding:12px 16px;background:${c.bg};border-left:4px solid ${c.border};border-radius:6px;font-size:13px;color:${c.text};line-height:1.5;">${message}</div>`;
}

export function getDefaultEmailTemplates(): AppEmailTemplates {
  return {
    signupOtp: {
      subject: "Verify your {companyName} account — {code}",
      html: `<h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Verify your email address</h2>
<p style="margin:0 0 16px;color:#4b5563;">Use the one-time code below to complete your account verification. Do not share this code with anyone.</p>
<div style="margin:24px 0;text-align:center;padding:24px;background:#f9fafb;border:2px dashed #d1d5db;border-radius:14px;">
  <p style="margin:0 0 6px;font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;">Your verification code</p>
  <div style="font-size:36px;font-weight:800;letter-spacing:0.28em;color:#111827;font-variant-numeric:tabular-nums;">{code}</div>
  <p style="margin:8px 0 0;font-size:12px;color:#9ca3af;">Valid for {expiryMinutes} minutes</p>
</div>
<p style="margin:0;font-size:13px;color:#9ca3af;">If you did not request this, you can safely ignore this email. Your account will not be affected.</p>`,
    },
    resetPassword: {
      subject: "Your temporary {companyName} password",
      html: `<h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Password reset</h2>
<p style="margin:0 0 16px;color:#4b5563;">Hello {userName}, an administrator has reset your password. Use the temporary password below to sign in, then change it immediately from your settings.</p>
<div style="margin:24px 0;padding:20px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;">
  <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;">Temporary password</p>
  <div style="font-size:20px;font-weight:800;letter-spacing:0.06em;color:#111827;font-family:monospace;">{tempPassword}</div>
  <p style="margin:8px 0 0;font-size:12px;color:#9ca3af;">Account: {email}</p>
</div>
${alertBox("Change your password immediately after signing in — temporary passwords are not secure for long-term use.", "warning")}`,
    },
    welcomeAccount: {
      subject: "Welcome to {companyName} — your account is ready",
      html: `<h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Welcome, {userName}!</h2>
<p style="margin:0 0 16px;color:#4b5563;">Your {companyName} account is activated and ready. Sign in using the credentials below to get started.</p>
${infoBox(["Role", "{role}"], ["Login email", "{email}"], ["Temporary password", "{tempPassword}"])}
<p style="margin:16px 0;color:#4b5563;">{welcomeNote}</p>
${alertBox("Sign in and update your password from your profile settings — temporary passwords expire.", "info")}
<p style="margin:16px 0 0;color:#4b5563;">Complete your profile after signing in so notifications, invoices, and job assignments reach you correctly.</p>`,
    },
    accountInvite: {
      subject: "You've been invited to {companyName}",
      html: `<h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Your portal account is ready</h2>
<p style="margin:0 0 16px;color:#4b5563;">Hello {userName}, an account has been created for you on <strong>{companyName}</strong>. Use the details below to sign in.</p>
${infoBox(["Role", "{role}"], ["Login email", "{email}"], ["Temporary password", "{tempPassword}"])}
<p style="margin:16px 0;color:#4b5563;">{welcomeNote}</p>
${alertBox("Change your password immediately after your first sign-in.", "warning")}`,
    },
    newProfileCreated: {
      subject: "{companyName}: New profile created - {userName}",
      html: `
        <h2 style="margin:0 0 12px;">New profile created</h2>
        <p>A new user profile was created through a non-admin flow.</p>
        <div style="margin:18px 0;padding:16px 18px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
          <p style="margin:0 0 6px;"><strong>Name:</strong> {userName}</p>
          <p style="margin:0 0 6px;"><strong>Email:</strong> {email}</p>
          <p style="margin:0 0 6px;"><strong>Role:</strong> {role}</p>
          <p style="margin:0 0 6px;"><strong>Created via:</strong> {createdVia}</p>
          <p style="margin:0;"><strong>Created at:</strong> {createdAt}</p>
        </div>
      `,
    },
    jobReminder24h: {
      subject: "Tomorrow: {jobType} at {propertyName} ({jobNumber})",
      html: `<h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Job reminder — tomorrow</h2>
<p style="margin:0 0 16px;color:#4b5563;">Hello {userName}, this is your 24-hour reminder for the job below. Please review all details and prepare before arrival.</p>
${infoBox(["Job #", "{jobNumber}"], ["Service", "{jobType}"], ["Property", "{propertyName}"], ["Address", "{propertyAddress}"], ["Scheduled", "{when}"])}
<p style="margin:0 0 16px;color:#4b5563;"><strong>Timing notes:</strong> {timingFlags}</p>
<p style="margin:0;font-size:13px;color:#4b5563;">Check access instructions, equipment requirements, stock levels, and any special notes before attending the property. Open the job in your portal for full details.</p>`,
    },
    jobAssigned: {
      subject: "Job assigned — {propertyName} ({jobNumber})",
      html: `<h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">New job assigned</h2>
<p style="margin:0 0 16px;color:#4b5563;">Hello {userName}, you have been assigned to the job below. Open it in the Cleaner Portal to confirm and view all access details.</p>
${infoBox(["Job #", "{jobNumber}"], ["Service", "{jobType}"], ["Property", "{propertyName}"], ["Scheduled", "{when}"], ["Timing notes", "{timingFlags}"])}`,
    },
    jobRemoved: {
      subject: "Job removed from your schedule ({jobNumber})",
      html: `<h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Job removed</h2>
<p style="margin:0 0 16px;color:#4b5563;">Hello {userName}, you have been removed from the following job. No further action is required from you.</p>
${infoBox(["Job #", "{jobNumber}"], ["Service", "{jobType}"], ["Property", "{propertyName}"], ["Was scheduled", "{when}"])}
<p style="margin:0;font-size:13px;color:#9ca3af;">If you believe this was an error, please contact your scheduler.</p>`,
    },
    laundryReady: {
      subject: "Laundry ready for pickup — {propertyName} ({jobNumber})",
      html: `<h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Laundry ready for pickup</h2>
<p style="margin:0 0 16px;color:#4b5563;">The cleaner has confirmed laundry is bagged and ready for collection at the property below.</p>
${infoBox(["Job #", "{jobNumber}"], ["Property", "{propertyName}"], ["Clean date", "{cleanDate}"], ["Pickup date", "{scheduledPickupDate}"], ["Drop-off date", "{scheduledDropoffDate}"], ["Bag location", "{bagLocation}"])}
<p style="margin:0;font-size:13px;color:#4b5563;">Open the Laundry Portal to confirm pickup and log the bag count.</p>`,
    },
    laundrySkipRequested: {
      subject: "{companyName}: Laundry skip requested - {propertyName} ({jobNumber})",
      html: `
        <h2 style="margin:0 0 12px;">Laundry pickup change requested</h2>
        <p>A cleaner submitted a laundry update that requires the pickup to be skipped or reviewed.</p>
        <div style="margin:18px 0;padding:16px 18px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
          <p style="margin:0 0 6px;"><strong>Job number:</strong> {jobNumber}</p>
          <p style="margin:0 0 6px;"><strong>Property:</strong> {propertyName}</p>
          <p style="margin:0 0 6px;"><strong>Clean date:</strong> {cleanDate}</p>
          <p style="margin:0 0 6px;"><strong>Outcome:</strong> {laundryOutcome}</p>
          <p style="margin:0 0 6px;"><strong>Reason:</strong> {reasonCode}</p>
          <p style="margin:0;"><strong>Cleaner note:</strong> {reasonNote}</p>
        </div>
      `,
    },
    laundrySkipApproved: {
      subject: "{companyName}: Laundry instruction updated - {propertyName} ({jobNumber})",
      html: `
        <h2 style="margin:0 0 12px;">Laundry instruction updated</h2>
        <p>The laundry booking instruction was reviewed and updated by admin.</p>
        <div style="margin:18px 0;padding:16px 18px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
          <p style="margin:0 0 6px;"><strong>Job number:</strong> {jobNumber}</p>
          <p style="margin:0 0 6px;"><strong>Property:</strong> {propertyName}</p>
          <p style="margin:0 0 6px;"><strong>Clean date:</strong> {cleanDate}</p>
          <p style="margin:0 0 6px;"><strong>Decision:</strong> {decision}</p>
          <p style="margin:0;"><strong>Note:</strong> {reasonNote}</p>
        </div>
      `,
    },
    cleaningReportShared: {
      subject: "Cleaning report ready — {propertyName} ({cleanDate})",
      html: `<h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Your cleaning report is ready</h2>
<p style="margin:0 0 16px;color:#4b5563;">Hello {clientName}, your <strong>{jobType}</strong> report for <strong>{propertyName}</strong> has been completed and is attached to this email.</p>
${infoBox(["Job #", "{jobNumber}"], ["Property", "{propertyName}"], ["Service date", "{cleanDate}"])}
<p style="margin:0;font-size:13px;color:#4b5563;">The PDF report is attached. You can also open the Client Portal to review your full service history, download past reports, and track upcoming services.</p>`,
    },
    reportVisibilityChanged: {
      subject: "{companyName}: Report visibility updated for {propertyName}",
      html: `
        <h2 style="margin:0 0 12px;">Report visibility updated</h2>
        <p>The visibility of a report has changed.</p>
        <div style="margin:18px 0;padding:16px 18px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
          <p style="margin:0 0 6px;"><strong>Job number:</strong> {jobNumber}</p>
          <p style="margin:0 0 6px;"><strong>Property:</strong> {propertyName}</p>
          <p style="margin:0 0 6px;"><strong>Audience:</strong> {visibilityAudience}</p>
          <p style="margin:0 0 6px;"><strong>New state:</strong> {visibilityState}</p>
          <p style="margin:0;"><strong>Note:</strong> {visibilityNote}</p>
        </div>
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
    clientInvoiceIssued: {
      subject: "Invoice {invoiceNumber} from {companyName}",
      html: `<h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Invoice ready</h2>
<p style="margin:0 0 16px;color:#4b5563;">Hello {clientName}, your invoice is attached to this email. Please review and arrange payment at your earliest convenience.</p>
${infoBox(["Invoice #", "{invoiceNumber}"], ["Billing period", "{periodLabel}"], ["Amount due", "<strong style='color:#0f766e;font-size:16px;'>{totalAmount}</strong>"])}
<p style="margin:0;font-size:13px;color:#4b5563;">Open the Client Portal to view your invoice history and download a PDF copy. If you have questions about this invoice, please reply to this email.</p>`,
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
      subject: "Pay request submitted — {propertyName} ({jobNumber})",
      html: `<h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Extra pay request submitted</h2>
<p style="margin:0 0 16px;color:#4b5563;">A cleaner has submitted an extra pay request that requires admin review and approval.</p>
${infoBox(["Cleaner", "{cleanerName}"], ["Property", "{propertyName}"], ["Job #", "{jobNumber}"], ["Service", "{jobType}"], ["Request type", "{requestType}"], ["Requested amount", "<strong style='color:#0f766e;'>{requestedAmount}</strong>"], ["Note", "{cleanerNote}"])}`,
    },
    caseCreated: {
      subject: "New case opened — {caseTitle}",
      html: `<h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">New case opened</h2>
<p style="margin:0 0 16px;color:#4b5563;">A new case has been opened and requires attention. Open the Admin Portal to review and assign next steps.</p>
${infoBox(["Type", "{caseType}"], ["Title", "{caseTitle}"], ["Property", "{propertyName}"], ["Job #", "{jobNumber}"], ["Status", "{status}"], ["Priority", "{priority}"])}`,
    },
    caseUpdated: {
      subject: "Case updated — {caseTitle} ({status})",
      html: `<h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Case updated</h2>
<p style="margin:0 0 16px;color:#4b5563;">An existing case has been updated. Please review the change below.</p>
${infoBox(["Type", "{caseType}"], ["Title", "{caseTitle}"], ["New status", "{status}"], ["Update note", "{updateNote}"])}`,
    },
    shoppingRunSubmitted: {
      subject: "{companyName}: Shopping run submitted - {runTitle}",
      html: `
        <h2 style="margin:0 0 12px;">Shopping run submitted</h2>
        <p>A shopping run is ready for review.</p>
        <div style="margin:18px 0;padding:16px 18px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
          <p style="margin:0 0 6px;"><strong>Run:</strong> {runTitle}</p>
          <p style="margin:0 0 6px;"><strong>Submitted by:</strong> {submittedBy}</p>
          <p style="margin:0 0 6px;"><strong>Paid by:</strong> {paidBy}</p>
          <p style="margin:0 0 6px;"><strong>Actual amount:</strong> {actualAmount}</p>
          <p style="margin:0;"><strong>Properties:</strong> {propertyNames}</p>
        </div>
      `,
    },
    shoppingReimbursementToClient: {
      subject: "{companyName}: Shopping reimbursement - {runTitle}",
      html: `
        <h2 style="margin:0 0 12px;">Shopping reimbursement</h2>
        <p>Hello {clientName},</p>
        <p>Please review the approved shopping reimbursement for your properties.</p>
        <div style="margin:18px 0;padding:16px 18px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
          <p style="margin:0 0 6px;"><strong>Run:</strong> {runTitle}</p>
          <p style="margin:0 0 6px;"><strong>Properties:</strong> {propertyNames}</p>
          <p style="margin:0;"><strong>Amount:</strong> {actualAmount}</p>
        </div>
      `,
    },
    stockRunRequested: {
      subject: "{companyName}: Stock count requested - {propertyName}",
      html: `
        <h2 style="margin:0 0 12px;">Stock count requested</h2>
        <p>A stock count run was requested for <strong>{propertyName}</strong>.</p>
        <p><strong>Requested by:</strong> {requestedBy}</p>
      `,
    },
    stockRunSubmitted: {
      subject: "{companyName}: Stock count submitted - {propertyName}",
      html: `
        <h2 style="margin:0 0 12px;">Stock count submitted</h2>
        <p>A stock count run was submitted for <strong>{propertyName}</strong>.</p>
        <p><strong>Submitted by:</strong> {submittedBy}</p>
        <p><strong>Lines counted:</strong> {lineCount}</p>
      `,
    },
    adminAttentionSummary: {
      subject: "{companyName}: Admin attention summary - {dateLabel}",
      html: `
        <h2 style="margin:0 0 12px;">Admin attention summary</h2>
        <p>Hello {recipientName},</p>
        <p>There are <strong>{attentionCount}</strong> admin items requiring attention today.</p>
        <p><strong>Approvals / review items:</strong> {approvalCount}</p>
        {breakdownHtml}
        <p>Please review the admin dashboard and clear the highest-priority items first.</p>
      `,
    },
    tomorrowJobsSummary: {
      subject: "{companyName}: Tomorrow's jobs for {roleLabel} - {dateLabel}",
      html: `
        <h2 style="margin:0 0 12px;">Tomorrow's job summary</h2>
        <p>Hello {recipientName},</p>
        <p>Here is your ordered summary for <strong>{dateLabel}</strong>.</p>
        <p><strong>Total jobs:</strong> {jobCount}</p>
        {summaryHtml}
      `,
    },
    tomorrowLaundrySummary: {
      subject: "{companyName}: Tomorrow's laundry schedule - {dateLabel}",
      html: `
        <h2 style="margin:0 0 12px;">Tomorrow's laundry schedule</h2>
        <p>Hello {recipientName},</p>
        <p>Here is your laundry pickup and drop-off summary for <strong>{dateLabel}</strong>.</p>
        <p><strong>Total tasks:</strong> {taskCount}</p>
        {summaryHtml}
      `,
    },
    criticalInventoryTomorrow: {
      subject: "{companyName}: Critical inventory alert for {dateLabel}",
      html: `
        <h2 style="margin:0 0 12px;">Critical inventory alert</h2>
        <p>Hello {recipientName},</p>
        <p>These properties scheduled for <strong>{dateLabel}</strong> have critical stock shortages.</p>
        <p><strong>Properties affected:</strong> {propertyCount}</p>
        <p><strong>Items affected:</strong> {itemCount}</p>
        {inventoryHtml}
      `,
    },
    quoteApprovalRequest: {
      subject: "Quote ready for approval — {clientName} ({serviceType})",
      html: `<h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Quote pending approval</h2>
<p style="margin:0 0 16px;color:#4b5563;">A new quote is ready for your review and approval before it is sent to the client.</p>
${infoBox(["Client", "{clientName}"], ["Service", "{serviceType}"], ["Total", "<strong style='color:#0f766e;font-size:16px;'>{quoteTotal}</strong>"])}`,
    },
    quoteSentToClient: {
      subject: "Your {companyName} quote is ready",
      html: `<h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Your quote is ready</h2>
<p style="margin:0 0 16px;color:#4b5563;">Hello {clientName}, we've prepared a quote for your requested service. Please review the details below and accept or request changes through the Client Portal.</p>
${infoBox(["Service", "{serviceType}"], ["Quote total", "<strong style='color:#0f766e;font-size:16px;'>{quoteTotal}</strong>"], ["Valid until", "{validUntil}"])}
<p style="margin:16px 0 0;font-size:13px;color:#4b5563;">Accept the quote online using the button below to confirm your booking. The quote will expire on <strong>{validUntil}</strong> — please respond before then to secure your preferred date.</p>`,
    },
  };
}

function buildCommonEmailVariables(settings: {
  companyName: string;
  projectName?: string;
  logoUrl: string;
  accountsEmail?: string;
  timezone?: string;
}) {
  const timezone = (settings.timezone || "Australia/Sydney").trim() || "Australia/Sydney";
  const now = new Date();
  const dateFormatter = new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeFormatter = new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
  const dateTimeFormatter = new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const appUrl = resolveAppUrl("/");
  return {
    companyName: settings.companyName,
    projectName: settings.projectName ?? "",
    logoUrl: settings.logoUrl,
    accountsEmail: settings.accountsEmail ?? "",
    supportEmail: settings.accountsEmail ?? "",
    timezone,
    appUrl,
    portalUrl: appUrl,
    loginUrl: resolveAppUrl("/login"),
    adminUrl: resolveAppUrl("/admin"),
    cleanerUrl: resolveAppUrl("/cleaner"),
    clientUrl: resolveAppUrl("/client"),
    laundryUrl: resolveAppUrl("/laundry"),
    jobsUrl: resolveAppUrl("/admin/jobs"),
    reportsUrl: resolveAppUrl("/admin/reports"),
    settingsUrl: resolveAppUrl("/admin/settings"),
    currentDate: dateFormatter.format(now),
    currentTime: timeFormatter.format(now),
    currentDateTime: dateTimeFormatter.format(now),
    currentDateIso: now.toISOString().slice(0, 10),
    currentDateTimeIso: now.toISOString(),
    currentYear: String(now.getUTCFullYear()),
    actionUrl: "",
    actionLabel: "Open details",
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
  const companyName = escapeHtml(settings.companyName);

  const logoSection = settings.logoUrl
    ? `<img src="${escapeAttribute(settings.logoUrl)}" alt="${companyName}" style="max-height:44px;max-width:180px;display:block;height:auto;width:auto;margin-bottom:10px;" />`
    : `<div style="display:inline-block;background:rgba(255,255,255,0.18);border-radius:12px;padding:8px 14px;font-size:18px;font-weight:800;letter-spacing:0.04em;color:#ffffff;margin-bottom:10px;">${companyName.slice(0, 2).toUpperCase()}</div>`;

  const actionButtonHtml = actionLink
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px 0;">
        <tr>
          <td style="border-radius:10px;background:#0f766e;box-shadow:0 4px 12px rgba(15,118,110,0.35);">
            <a href="${escapeAttribute(actionLink.url)}" target="_blank" rel="noopener noreferrer"
              style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.01em;">
              ${escapeHtml(actionLink.label)} &rarr;
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
    <meta name="x-apple-disable-message-reformatting" />
    <title>${companyName}</title>
    <style>
      @media only screen and (max-width: 640px) {
        .wrapper { padding: 12px !important; }
        .card { border-radius: 14px !important; }
        .header { padding: 22px 20px !important; }
        .body { padding: 22px 20px !important; }
        .h2 { font-size: 20px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#edf2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1a202c;-webkit-text-size-adjust:100%;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="wrapper" style="padding:32px 16px;">
      <tr>
        <td align="center">

          <!-- Card -->
          <table role="presentation" class="card" width="600" cellpadding="0" cellspacing="0" border="0"
            style="width:600px;max-width:100%;border-radius:18px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,0.08);border:1px solid #e2e8f0;">

            <!-- Header -->
            <tr>
              <td class="header" style="padding:28px 32px;background:linear-gradient(140deg,#0f766e 0%,#0d9488 55%,#0e7490 100%);">
                ${logoSection}
                <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.01em;line-height:1.2;">${companyName}</div>
                <div style="margin-top:4px;font-size:12px;font-weight:500;color:rgba(255,255,255,0.72);letter-spacing:0.06em;text-transform:uppercase;">Operations Portal</div>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td class="body" style="padding:32px;background:#ffffff;">
                <div style="font-size:15px;line-height:1.75;color:#374151;">
                  ${innerHtml}
                </div>
                ${actionButtonHtml}
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e9ecef;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="font-size:12px;color:#6b7280;line-height:1.6;">
                      <strong style="color:#374151;">${companyName}</strong><br />
                      This is an automated notification from your operations dashboard.<br />
                      If you received this in error, please disregard it.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

          </table>
          <!-- /Card -->

        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderEmailTemplate(
  settings: {
    companyName: string;
    projectName?: string;
    logoUrl: string;
    accountsEmail?: string;
    timezone?: string;
    emailTemplates: AppEmailTemplates;
  },
  key: AppEmailTemplateKey,
  variables: Record<string, unknown>
) {
  const template = settings.emailTemplates[key] ?? getDefaultEmailTemplates()[key];
  const mergedVariables = normalizeTemplateVariables({
    ...buildCommonEmailVariables(settings),
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
