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
    accountInvite: {
      subject: "You have been invited to {companyName}",
      html: `
        <h2 style="margin:0 0 12px;">Your portal account is ready</h2>
        <p>Hello {userName},</p>
        <p>An account has been created for you on <strong>{companyName}</strong>.</p>
        <p><strong>Portal role:</strong> {role}</p>
        <p><strong>Login email:</strong> {email}</p>
        <p><strong>Temporary password:</strong> {tempPassword}</p>
        <p>{welcomeNote}</p>
        <p>Sign in and complete your setup from the button below.</p>
      `,
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
      subject: "Tomorrow's job reminder - {jobNumber} - {propertyName}",
      html: `
        <h2 style="margin:0 0 12px;">Upcoming job reminder</h2>
        <p>Hello {userName},</p>
        <p>This is your scheduled reminder for tomorrow's job. Please review the details below and prepare before arrival.</p>
        <div style="margin:18px 0;padding:16px 18px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
          <p style="margin:0 0 6px;"><strong>Job number:</strong> {jobNumber}</p>
          <p style="margin:0 0 6px;"><strong>Service:</strong> {jobType}</p>
          <p style="margin:0 0 6px;"><strong>Property:</strong> {propertyName}</p>
          <p style="margin:0 0 6px;"><strong>Address:</strong> {propertyAddress}</p>
          <p style="margin:0;"><strong>Schedule:</strong> {when}</p>
        </div>
        <p><strong>Timing notes:</strong> {timingFlags}</p>
        <p>Please check access instructions, equipment needs, stock expectations, and any special notes before attending the property.</p>
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
          <p style="margin:0 0 6px;"><strong>Scheduled pickup date:</strong> {scheduledPickupDate}</p>
          <p style="margin:0;"><strong>Bag location:</strong> {bagLocation}</p>
        </div>
        <p><a href="{laundryPhotoUrl}" target="_blank" rel="noopener noreferrer">View laundry photo</a></p>
      `,
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
      subject: "{companyName} invoice {invoiceNumber}",
      html: `
        <h2 style="margin:0 0 12px;">Invoice ready</h2>
        <p>Hello {clientName},</p>
        <p>Your invoice is ready.</p>
        <div style="margin:18px 0;padding:16px 18px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
          <p style="margin:0 0 6px;"><strong>Invoice number:</strong> {invoiceNumber}</p>
          <p style="margin:0 0 6px;"><strong>Billing period:</strong> {periodLabel}</p>
          <p style="margin:0;"><strong>Total:</strong> {totalAmount}</p>
        </div>
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
    caseCreated: {
      subject: "{companyName}: New {caseType} case - {caseTitle}",
      html: `
        <h2 style="margin:0 0 12px;">New case created</h2>
        <p>A new case has been opened in the system.</p>
        <div style="margin:18px 0;padding:16px 18px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
          <p style="margin:0 0 6px;"><strong>Type:</strong> {caseType}</p>
          <p style="margin:0 0 6px;"><strong>Title:</strong> {caseTitle}</p>
          <p style="margin:0 0 6px;"><strong>Property:</strong> {propertyName}</p>
          <p style="margin:0 0 6px;"><strong>Job number:</strong> {jobNumber}</p>
          <p style="margin:0 0 6px;"><strong>Status:</strong> {status}</p>
          <p style="margin:0;"><strong>Priority:</strong> {priority}</p>
        </div>
      `,
    },
    caseUpdated: {
      subject: "{companyName}: Case updated - {caseTitle}",
      html: `
        <h2 style="margin:0 0 12px;">Case updated</h2>
        <p>An existing case has been updated.</p>
        <div style="margin:18px 0;padding:16px 18px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
          <p style="margin:0 0 6px;"><strong>Type:</strong> {caseType}</p>
          <p style="margin:0 0 6px;"><strong>Title:</strong> {caseTitle}</p>
          <p style="margin:0 0 6px;"><strong>Status:</strong> {status}</p>
          <p style="margin:0;"><strong>Update:</strong> {updateNote}</p>
        </div>
      `,
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
      subject: "{companyName}: Quote approval required - {serviceType}",
      html: `
        <h2 style="margin:0 0 12px;">Quote approval required</h2>
        <p>A quote is ready for review.</p>
        <p><strong>Client:</strong> {clientName}</p>
        <p><strong>Service:</strong> {serviceType}</p>
        <p><strong>Total:</strong> {quoteTotal}</p>
      `,
    },
    quoteSentToClient: {
      subject: "{companyName}: Your quote is ready",
      html: `
        <h2 style="margin:0 0 12px;">Your quote is ready</h2>
        <p>Hello {clientName},</p>
        <p>Your quote for <strong>{serviceType}</strong> is ready to review.</p>
        <p><strong>Total:</strong> {quoteTotal}</p>
        <p><strong>Valid until:</strong> {validUntil}</p>
      `,
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
  const logoHtml = settings.logoUrl
    ? `
      <div style="display:inline-flex;align-items:center;justify-content:center;padding:12px 16px;border-radius:16px;background:#ffffff;border:1px solid #dbe3ee;box-shadow:0 8px 18px rgba(15,23,42,0.12);">
        <div style="display:flex;align-items:center;justify-content:center;background:#ffffff;border-radius:12px;padding:6px 10px;">
          <img src="${escapeAttribute(settings.logoUrl)}" alt="${escapeHtml(settings.companyName)}" style="background:#ffffff;max-height:56px;max-width:220px;display:block;height:auto;width:auto;" />
        </div>
      </div>
    `
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
