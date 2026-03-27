import { resolveAppUrl } from "@/lib/app-url";

export type AppNotificationTemplateKey =
  | "newProfileCreated"
  | "jobAssigned"
  | "jobRemoved"
  | "jobUpdated"
  | "laundryReady"
  | "laundrySkipRequested"
  | "extraPayRequest"
  | "caseCreated"
  | "caseUpdated"
  | "shoppingRunSubmitted"
  | "stockRunRequested"
  | "stockRunSubmitted"
  | "adminAttentionSummary"
  | "tomorrowJobsSummary"
  | "tomorrowLaundrySummary"
  | "criticalInventoryTomorrow";

export interface NotificationTemplateConfig {
  webSubject: string;
  webBody: string;
  smsBody: string;
}

export type AppNotificationTemplates = Record<AppNotificationTemplateKey, NotificationTemplateConfig>;

export const COMMON_NOTIFICATION_TEMPLATE_VARIABLES = [
  "companyName",
  "projectName",
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

export const NOTIFICATION_TEMPLATE_KEYS: AppNotificationTemplateKey[] = [
  "newProfileCreated",
  "jobAssigned",
  "jobRemoved",
  "jobUpdated",
  "laundryReady",
  "laundrySkipRequested",
  "extraPayRequest",
  "caseCreated",
  "caseUpdated",
  "shoppingRunSubmitted",
  "stockRunRequested",
  "stockRunSubmitted",
  "adminAttentionSummary",
  "tomorrowJobsSummary",
  "tomorrowLaundrySummary",
  "criticalInventoryTomorrow",
];

function mergeTemplateVariableLists(...lists: ReadonlyArray<ReadonlyArray<string>>) {
  return Array.from(new Set(lists.flatMap((list) => list)));
}

const NOTIFICATION_TEMPLATE_DEFINITIONS_BASE: Record<
  AppNotificationTemplateKey,
  { label: string; variables: string[] }
> = {
  newProfileCreated: {
    label: "New Profile Created",
    variables: ["userName", "email", "role", "createdVia", "createdAt"],
  },
  jobAssigned: {
    label: "Job Assigned",
    variables: ["jobNumber", "jobType", "propertyName", "when", "timingFlags"],
  },
  jobRemoved: {
    label: "Job Removed",
    variables: ["jobNumber", "jobType", "propertyName", "when", "timingFlags"],
  },
  jobUpdated: {
    label: "Job Updated",
    variables: ["jobNumber", "propertyName", "changeSummary", "immediateAttention"],
  },
  laundryReady: {
    label: "Laundry Ready",
    variables: ["jobNumber", "propertyName", "cleanDate", "scheduledPickupDate", "scheduledDropoffDate", "bagLocation"],
  },
  laundrySkipRequested: {
    label: "Laundry Skip Requested",
    variables: ["jobNumber", "propertyName", "cleanDate", "laundryOutcome", "reasonCode", "reasonNote"],
  },
  extraPayRequest: {
    label: "Extra Pay Request",
    variables: ["jobNumber", "cleanerName", "propertyName", "requestedAmount", "requestType"],
  },
  caseCreated: {
    label: "Case Created",
    variables: ["caseTitle", "propertyName", "jobNumber", "status", "priority"],
  },
  caseUpdated: {
    label: "Case Updated",
    variables: ["caseTitle", "status", "updateNote"],
  },
  shoppingRunSubmitted: {
    label: "Shopping Run Submitted",
    variables: ["runTitle", "submittedBy", "paidBy", "actualAmount", "propertyNames"],
  },
  stockRunRequested: {
    label: "Stock Run Requested",
    variables: ["propertyName", "requestedBy", "runTitle"],
  },
  stockRunSubmitted: {
    label: "Stock Run Submitted",
    variables: ["propertyName", "submittedBy", "runTitle", "lineCount"],
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
      "breakdownText",
    ],
  },
  tomorrowJobsSummary: {
    label: "Tomorrow Jobs Summary",
    variables: ["recipientName", "roleLabel", "dateLabel", "jobCount", "summaryText"],
  },
  tomorrowLaundrySummary: {
    label: "Tomorrow Laundry Summary",
    variables: ["recipientName", "dateLabel", "taskCount", "summaryText"],
  },
  criticalInventoryTomorrow: {
    label: "Critical Inventory Tomorrow",
    variables: ["recipientName", "roleLabel", "dateLabel", "propertyCount", "itemCount", "inventoryText"],
  },
};

export const NOTIFICATION_TEMPLATE_DEFINITIONS: Record<
  AppNotificationTemplateKey,
  { label: string; variables: string[] }
> = Object.fromEntries(
  Object.entries(NOTIFICATION_TEMPLATE_DEFINITIONS_BASE).map(([key, definition]) => [
    key,
    {
      ...definition,
      variables: mergeTemplateVariableLists(COMMON_NOTIFICATION_TEMPLATE_VARIABLES, definition.variables),
    },
  ])
) as Record<AppNotificationTemplateKey, { label: string; variables: string[] }>;

export function getDefaultNotificationTemplates(): AppNotificationTemplates {
  return {
    newProfileCreated: {
      webSubject: "New profile created",
      webBody: "{userName} ({email}) completed {createdVia}.",
      smsBody: "New profile: {userName} ({role}) completed {createdVia}.",
    },
    jobAssigned: {
      webSubject: "Job assignment updated ({jobNumber})",
      webBody: "{jobNumber}: Assigned to {jobType} at {propertyName} on {when}. {timingFlags}",
      smsBody: "{jobNumber} assigned: {jobType} at {propertyName} on {when}. {timingFlags}",
    },
    jobRemoved: {
      webSubject: "Job removed from schedule ({jobNumber})",
      webBody: "{jobNumber}: Removed from {jobType} at {propertyName} on {when}. {timingFlags}",
      smsBody: "{jobNumber} removed: {jobType} at {propertyName} on {when}. {timingFlags}",
    },
    jobUpdated: {
      webSubject: "Job updated ({jobNumber}){immediateAttention}",
      webBody: "{jobNumber} updated for {propertyName}. {changeSummary}",
      smsBody: "{jobNumber} updated for {propertyName}. {immediateAttention}{changeSummary}",
    },
    laundryReady: {
      webSubject: "Laundry ready - {jobNumber}",
      webBody:
        "{jobNumber} ready for pickup at {propertyName} on {cleanDate}. Pickup {scheduledPickupDate}. Drop-off {scheduledDropoffDate}. Location: {bagLocation}",
      smsBody:
        "{jobNumber}: Laundry ready for {propertyName} on {cleanDate}. Pickup {scheduledPickupDate}. Drop-off {scheduledDropoffDate}. Location: {bagLocation}.",
    },
    laundrySkipRequested: {
      webSubject: "Laundry update - {jobNumber}",
      webBody:
        "{jobNumber}: {laundryOutcome} for {propertyName}. {reasonCode}{reasonNote}",
      smsBody:
        "{jobNumber}: {laundryOutcome} for {propertyName}. {reasonCode}{reasonNote}",
    },
    extraPayRequest: {
      webSubject: "Cleaner extra pay request ({jobNumber})",
      webBody:
        "{jobNumber}: {cleanerName} requested {requestType} extra pay for {propertyName} ({requestedAmount}).",
      smsBody:
        "{jobNumber}: {cleanerName} requested {requestType} extra pay for {propertyName} ({requestedAmount}).",
    },
    caseCreated: {
      webSubject: "Case created",
      webBody: "{caseTitle} opened for {propertyName}. Job {jobNumber}. Priority: {priority}.",
      smsBody: "Case opened: {caseTitle} at {propertyName}. Job {jobNumber}. Priority: {priority}.",
    },
    caseUpdated: {
      webSubject: "Case updated",
      webBody: "{caseTitle} - {updateNote}",
      smsBody: "{caseTitle}: {updateNote}",
    },
    shoppingRunSubmitted: {
      webSubject: "Shopping run submitted",
      webBody: "{runTitle} submitted by {submittedBy}. Paid by {paidBy}. Total {actualAmount}.",
      smsBody: "{runTitle} submitted by {submittedBy}. Paid by {paidBy}. Total {actualAmount}.",
    },
    stockRunRequested: {
      webSubject: "Stock count requested",
      webBody: "{propertyName}: {requestedBy} started {runTitle}.",
      smsBody: "{propertyName}: {requestedBy} started {runTitle}.",
    },
    stockRunSubmitted: {
      webSubject: "Stock count submitted",
      webBody: "{propertyName}: {submittedBy} submitted {runTitle} ({lineCount} lines).",
      smsBody: "{propertyName}: {submittedBy} submitted {runTitle} ({lineCount} lines).",
    },
    adminAttentionSummary: {
      webSubject: "Admin attention summary - {dateLabel}",
      webBody: "{attentionCount} admin items need attention. {breakdownText}",
      smsBody: "Admin summary: {attentionCount} items. Approvals {approvalCount}; Unassigned {unassignedJobCount}; Open cases {openCaseCount}; Laundry {flaggedLaundryCount}.",
    },
    tomorrowJobsSummary: {
      webSubject: "Tomorrow jobs for {roleLabel} - {dateLabel}",
      webBody: "{jobCount} jobs scheduled for {dateLabel}. {summaryText}",
      smsBody: "Tomorrow jobs ({jobCount}) - {summaryText}",
    },
    tomorrowLaundrySummary: {
      webSubject: "Tomorrow laundry schedule - {dateLabel}",
      webBody: "{taskCount} laundry tasks scheduled for {dateLabel}. {summaryText}",
      smsBody: "Tomorrow laundry ({taskCount}) - {summaryText}",
    },
    criticalInventoryTomorrow: {
      webSubject: "Critical inventory alert for {dateLabel}",
      webBody: "{propertyCount} properties and {itemCount} items need action. {inventoryText}",
      smsBody: "Critical stock for tomorrow: {inventoryText}",
    },
  };
}

function sanitizeText(value: unknown, max = 500) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export function sanitizeNotificationTemplates(
  input: unknown,
  fallback: AppNotificationTemplates
): AppNotificationTemplates {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fallback;
  const parsed = input as Record<string, unknown>;
  const next = { ...fallback };
  for (const key of NOTIFICATION_TEMPLATE_KEYS) {
    const row = parsed[key];
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const template = row as Record<string, unknown>;
    next[key] = {
      webSubject: sanitizeText(template.webSubject, 200) || fallback[key].webSubject,
      webBody: sanitizeText(template.webBody, 2000) || fallback[key].webBody,
      smsBody: sanitizeText(template.smsBody, 320) || fallback[key].smsBody,
    };
  }
  return next;
}

function normalizeVariables(variables: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(variables).map(([key, value]) => [key, String(value ?? "")])
  );
}

function buildCommonNotificationVariables(settings: {
  companyName?: string;
  projectName?: string;
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
    companyName: settings.companyName ?? "",
    projectName: settings.projectName ?? "",
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

function replaceVariables(template: string, variables: Record<string, string>) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name: string) => variables[name] ?? "");
}

export function renderNotificationTemplate(
  settings: {
    notificationTemplates: AppNotificationTemplates;
    companyName?: string;
    projectName?: string;
    accountsEmail?: string;
    timezone?: string;
  },
  key: AppNotificationTemplateKey,
  variables: Record<string, unknown>
) {
  const mergedVariables = normalizeVariables({
    ...buildCommonNotificationVariables(settings),
    ...variables,
  });
  const template = settings.notificationTemplates[key] ?? getDefaultNotificationTemplates()[key];
  return {
    webSubject: replaceVariables(template.webSubject, mergedVariables),
    webBody: replaceVariables(template.webBody, mergedVariables),
    smsBody: replaceVariables(template.smsBody, mergedVariables),
  };
}
