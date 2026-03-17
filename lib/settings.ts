import { JobType, Role } from "@prisma/client";
import { db } from "@/lib/db";
import {
  getDefaultEmailTemplates,
  sanitizeEmailTemplates,
  type AppEmailTemplates,
} from "@/lib/email-templates";

export interface ProfileEditPolicy {
  canEditName: boolean;
  canEditPhone: boolean;
  canEditEmail: boolean;
}

export interface ClientPortalVisibility {
  showCalendar: boolean;
  showReports: boolean;
  showInventory: boolean;
  showShopping: boolean;
  showOngoingJobs: boolean;
  showCases: boolean;
  showExtraPayRequests: boolean;
  showCleanerNames: boolean;
  showLaundryCosts: boolean;
  showQuoteRequests: boolean;
  showApprovals: boolean;
}

export interface CleanerPortalVisibility {
  showJobs: boolean;
  showCalendar: boolean;
  showShopping: boolean;
  showInvoices: boolean;
  showPayRequests: boolean;
  showLostFound: boolean;
}

export interface LaundryPortalVisibility {
  showCalendar: boolean;
  showInvoices: boolean;
  showHistoryTab: boolean;
  showCostTracking: boolean;
  showPickupPhoto: boolean;
  requireDropoffPhoto: boolean;
  requireEarlyDropoffReason: boolean;
}

export interface LaundryOperationsSettings {
  pickupCutoffTime: string;
  defaultPickupTime: string;
  defaultDropoffTime: string;
  maxOutdoorDays: number;
  fastReturnWhenNoNextClean: boolean;
  fastReturnDaysWhenNoNextClean: number;
}

export interface SlaSettings {
  enabled: boolean;
  warnHoursBeforeDue: number;
  overdueEscalationMinutes: number;
  createIssueOnOverdue: boolean;
  notifyAdminOnOverdue: boolean;
}

export interface RecurringJobSettings {
  enabled: boolean;
  lookaheadDays: number;
}

export interface AutoAssignSettings {
  enabled: boolean;
  maxDailyJobsPerCleaner: number;
  weightSuburbHistory: number;
  weightQaScore: number;
  weightCurrentLoad: number;
}

export interface RouteOptimizationSettings {
  enabled: boolean;
  groupBySuburb: boolean;
  maxStopsPerRun: number;
}

export interface QaAutomationSettings {
  failureThreshold: number;
  autoCreateReworkJob: boolean;
  reworkDelayHours: number;
  createIssueTicket: boolean;
}

export type PropertyFormTemplateOverrides = Record<string, Partial<Record<JobType, string>>>;

export interface AppSettings {
  companyName: string;
  projectName: string;
  logoUrl: string;
  accountsEmail: string;
  timezone: string;
  reminder24hHours: number;
  reminder2hHours: number;
  cleanerStartRequireDateMatch: boolean;
  cleanerStartRequireChecklistConfirm: boolean;
  strictClientAdminOnly: boolean;
  quoteDefaultValidityDays: number;
  quoteDefaultEmailSubject: string;
  laundryBagLocationOptions: string[];
  laundryDropoffLocationOptions: string[];
  selectAllAllowedCleanerIds: string[];
  cleanerJobHourlyRates: Record<string, Partial<Record<JobType, number>>>;
  profileEditPolicy: Record<Role, ProfileEditPolicy>;
  profileEditOverrides: Record<string, ProfileEditPolicy>;
  clientPortalVisibility: ClientPortalVisibility;
  cleanerPortalVisibility: CleanerPortalVisibility;
  laundryPortalVisibility: LaundryPortalVisibility;
  laundryOperations: LaundryOperationsSettings;
  sla: SlaSettings;
  recurringJobs: RecurringJobSettings;
  autoAssign: AutoAssignSettings;
  routeOptimization: RouteOptimizationSettings;
  qaAutomation: QaAutomationSettings;
  propertyFormTemplateOverrides: PropertyFormTemplateOverrides;
  emailTemplates: AppEmailTemplates;
}

export const DEFAULT_SETTINGS: AppSettings = {
  companyName: "sNeek Property Services",
  projectName: "sneek-ops-dashboard",
  logoUrl: "",
  accountsEmail: "accounts@sneekproservices.com.au",
  timezone: "Australia/Sydney",
  reminder24hHours: 24,
  reminder2hHours: 2,
  cleanerStartRequireDateMatch: true,
  cleanerStartRequireChecklistConfirm: true,
  strictClientAdminOnly: true,
  quoteDefaultValidityDays: 14,
  quoteDefaultEmailSubject: "Your sNeek Property Services Quote",
  laundryBagLocationOptions: [
    "Laundry room shelf",
    "Laundry bin",
    "Near front door",
    "Inside linen cupboard",
    "Building concierge",
    "Garage storage",
  ],
  laundryDropoffLocationOptions: [
    "Front door",
    "Laundry bin",
    "Laundry room shelf",
    "Linen cupboard",
    "Concierge desk",
    "Garage storage",
  ],
  selectAllAllowedCleanerIds: [],
  cleanerJobHourlyRates: {},
  profileEditPolicy: {
    [Role.ADMIN]: { canEditName: true, canEditPhone: true, canEditEmail: true },
    [Role.OPS_MANAGER]: { canEditName: true, canEditPhone: true, canEditEmail: true },
    [Role.CLEANER]: { canEditName: true, canEditPhone: true, canEditEmail: false },
    [Role.CLIENT]: { canEditName: true, canEditPhone: true, canEditEmail: false },
    [Role.LAUNDRY]: { canEditName: true, canEditPhone: true, canEditEmail: false },
  },
  profileEditOverrides: {},
  clientPortalVisibility: {
    showCalendar: true,
    showReports: true,
    showInventory: true,
    showShopping: true,
    showOngoingJobs: true,
    showCases: false,
    showExtraPayRequests: false,
    showCleanerNames: false,
    showLaundryCosts: true,
    showQuoteRequests: true,
    showApprovals: true,
  },
  cleanerPortalVisibility: {
    showJobs: true,
    showCalendar: true,
    showShopping: true,
    showInvoices: true,
    showPayRequests: true,
    showLostFound: true,
  },
  laundryPortalVisibility: {
    showCalendar: true,
    showInvoices: true,
    showHistoryTab: true,
    showCostTracking: true,
    showPickupPhoto: true,
    requireDropoffPhoto: true,
    requireEarlyDropoffReason: true,
  },
  laundryOperations: {
    pickupCutoffTime: "10:00",
    defaultPickupTime: "09:00",
    defaultDropoffTime: "16:00",
    maxOutdoorDays: 3,
    fastReturnWhenNoNextClean: true,
    fastReturnDaysWhenNoNextClean: 1,
  },
  sla: {
    enabled: true,
    warnHoursBeforeDue: 2,
    overdueEscalationMinutes: 30,
    createIssueOnOverdue: true,
    notifyAdminOnOverdue: true,
  },
  recurringJobs: {
    enabled: true,
    lookaheadDays: 14,
  },
  autoAssign: {
    enabled: true,
    maxDailyJobsPerCleaner: 4,
    weightSuburbHistory: 40,
    weightQaScore: 35,
    weightCurrentLoad: 25,
  },
  routeOptimization: {
    enabled: true,
    groupBySuburb: true,
    maxStopsPerRun: 12,
  },
  qaAutomation: {
    failureThreshold: 80,
    autoCreateReworkJob: true,
    reworkDelayHours: 24,
    createIssueTicket: true,
  },
  propertyFormTemplateOverrides: {},
  emailTemplates: getDefaultEmailTemplates(),
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sanitizeHourlyRates(
  input: unknown,
  fallback: Record<string, Partial<Record<JobType, number>>>
) {
  if (!input || typeof input !== "object") return fallback;
  const parsed = input as Record<string, unknown>;
  const output: Record<string, Partial<Record<JobType, number>>> = {};
  const jobTypes = Object.values(JobType);

  for (const [cleanerId, rawRates] of Object.entries(parsed)) {
    if (!cleanerId || typeof rawRates !== "object" || !rawRates) continue;
    const row = rawRates as Record<string, unknown>;
    const sanitizedRow: Partial<Record<JobType, number>> = {};

    for (const jobType of jobTypes) {
      const rawValue = row[jobType];
      if (rawValue === undefined || rawValue === null || rawValue === "") continue;
      const numeric = Number(rawValue);
      if (!Number.isFinite(numeric)) continue;
      if (numeric < 0) continue;
      sanitizedRow[jobType] = clamp(numeric, 0, 1000);
    }

    if (Object.keys(sanitizedRow).length > 0) {
      output[cleanerId] = sanitizedRow;
    }
  }

  return output;
}

function sanitizeRolePolicy(input: unknown, fallback: Record<Role, ProfileEditPolicy>) {
  if (!input || typeof input !== "object") return fallback;
  const parsed = input as Record<string, unknown>;

  const out: Record<Role, ProfileEditPolicy> = { ...fallback };
  const roles = Object.values(Role);
  for (const role of roles) {
    const row = parsed[role] as Record<string, unknown> | undefined;
    if (!row || typeof row !== "object") continue;
    out[role] = {
      canEditName: typeof row.canEditName === "boolean" ? row.canEditName : fallback[role].canEditName,
      canEditPhone: typeof row.canEditPhone === "boolean" ? row.canEditPhone : fallback[role].canEditPhone,
      canEditEmail: typeof row.canEditEmail === "boolean" ? row.canEditEmail : fallback[role].canEditEmail,
    };
  }

  return out;
}

function sanitizeClientPortalVisibility(
  input: unknown,
  fallback: ClientPortalVisibility
): ClientPortalVisibility {
  if (!input || typeof input !== "object") return fallback;
  const row = input as Record<string, unknown>;
  return {
    showCalendar: typeof row.showCalendar === "boolean" ? row.showCalendar : fallback.showCalendar,
    showReports: typeof row.showReports === "boolean" ? row.showReports : fallback.showReports,
    showInventory: typeof row.showInventory === "boolean" ? row.showInventory : fallback.showInventory,
    showShopping: typeof row.showShopping === "boolean" ? row.showShopping : fallback.showShopping,
    showOngoingJobs: typeof row.showOngoingJobs === "boolean" ? row.showOngoingJobs : fallback.showOngoingJobs,
    showCases: typeof row.showCases === "boolean" ? row.showCases : fallback.showCases,
    showExtraPayRequests:
      typeof row.showExtraPayRequests === "boolean"
        ? row.showExtraPayRequests
        : fallback.showExtraPayRequests,
    showCleanerNames:
      typeof row.showCleanerNames === "boolean" ? row.showCleanerNames : fallback.showCleanerNames,
    showLaundryCosts:
      typeof row.showLaundryCosts === "boolean" ? row.showLaundryCosts : fallback.showLaundryCosts,
    showQuoteRequests:
      typeof row.showQuoteRequests === "boolean" ? row.showQuoteRequests : fallback.showQuoteRequests,
    showApprovals:
      typeof row.showApprovals === "boolean" ? row.showApprovals : fallback.showApprovals,
  };
}

function sanitizeCleanerPortalVisibility(
  input: unknown,
  fallback: CleanerPortalVisibility
): CleanerPortalVisibility {
  if (!input || typeof input !== "object") return fallback;
  const row = input as Record<string, unknown>;
  return {
    showJobs: typeof row.showJobs === "boolean" ? row.showJobs : fallback.showJobs,
    showCalendar: typeof row.showCalendar === "boolean" ? row.showCalendar : fallback.showCalendar,
    showShopping: typeof row.showShopping === "boolean" ? row.showShopping : fallback.showShopping,
    showInvoices: typeof row.showInvoices === "boolean" ? row.showInvoices : fallback.showInvoices,
    showPayRequests: typeof row.showPayRequests === "boolean" ? row.showPayRequests : fallback.showPayRequests,
    showLostFound: typeof row.showLostFound === "boolean" ? row.showLostFound : fallback.showLostFound,
  };
}

function sanitizeLaundryPortalVisibility(
  input: unknown,
  fallback: LaundryPortalVisibility
): LaundryPortalVisibility {
  if (!input || typeof input !== "object") return fallback;
  const row = input as Record<string, unknown>;
  return {
    showCalendar: typeof row.showCalendar === "boolean" ? row.showCalendar : fallback.showCalendar,
    showInvoices: typeof row.showInvoices === "boolean" ? row.showInvoices : fallback.showInvoices,
    showHistoryTab: typeof row.showHistoryTab === "boolean" ? row.showHistoryTab : fallback.showHistoryTab,
    showCostTracking: typeof row.showCostTracking === "boolean" ? row.showCostTracking : fallback.showCostTracking,
    showPickupPhoto: typeof row.showPickupPhoto === "boolean" ? row.showPickupPhoto : fallback.showPickupPhoto,
    requireDropoffPhoto:
      typeof row.requireDropoffPhoto === "boolean" ? row.requireDropoffPhoto : fallback.requireDropoffPhoto,
    requireEarlyDropoffReason:
      typeof row.requireEarlyDropoffReason === "boolean"
        ? row.requireEarlyDropoffReason
        : fallback.requireEarlyDropoffReason,
  };
}

function sanitizeLaundryOperations(
  input: unknown,
  fallback: LaundryOperationsSettings
): LaundryOperationsSettings {
  if (!input || typeof input !== "object") return fallback;
  const row = input as Record<string, unknown>;
  const timePattern = /^\d{2}:\d{2}$/;
  return {
    pickupCutoffTime:
      typeof row.pickupCutoffTime === "string" && timePattern.test(row.pickupCutoffTime)
        ? row.pickupCutoffTime
        : fallback.pickupCutoffTime,
    defaultPickupTime:
      typeof row.defaultPickupTime === "string" && timePattern.test(row.defaultPickupTime)
        ? row.defaultPickupTime
        : fallback.defaultPickupTime,
    defaultDropoffTime:
      typeof row.defaultDropoffTime === "string" && timePattern.test(row.defaultDropoffTime)
        ? row.defaultDropoffTime
        : fallback.defaultDropoffTime,
    maxOutdoorDays: clamp(Number(row.maxOutdoorDays ?? fallback.maxOutdoorDays), 1, 14),
    fastReturnWhenNoNextClean:
      typeof row.fastReturnWhenNoNextClean === "boolean"
        ? row.fastReturnWhenNoNextClean
        : fallback.fastReturnWhenNoNextClean,
    fastReturnDaysWhenNoNextClean: clamp(
      Number(row.fastReturnDaysWhenNoNextClean ?? fallback.fastReturnDaysWhenNoNextClean),
      1,
      7
    ),
  };
}

function sanitizeSlaSettings(input: unknown, fallback: SlaSettings): SlaSettings {
  if (!input || typeof input !== "object") return fallback;
  const row = input as Record<string, unknown>;
  return {
    enabled: typeof row.enabled === "boolean" ? row.enabled : fallback.enabled,
    warnHoursBeforeDue: clamp(Number(row.warnHoursBeforeDue ?? fallback.warnHoursBeforeDue), 1, 72),
    overdueEscalationMinutes: clamp(Number(row.overdueEscalationMinutes ?? fallback.overdueEscalationMinutes), 5, 1440),
    createIssueOnOverdue:
      typeof row.createIssueOnOverdue === "boolean"
        ? row.createIssueOnOverdue
        : fallback.createIssueOnOverdue,
    notifyAdminOnOverdue:
      typeof row.notifyAdminOnOverdue === "boolean"
        ? row.notifyAdminOnOverdue
        : fallback.notifyAdminOnOverdue,
  };
}

function sanitizeRecurringJobSettings(input: unknown, fallback: RecurringJobSettings): RecurringJobSettings {
  if (!input || typeof input !== "object") return fallback;
  const row = input as Record<string, unknown>;
  return {
    enabled: typeof row.enabled === "boolean" ? row.enabled : fallback.enabled,
    lookaheadDays: clamp(Number(row.lookaheadDays ?? fallback.lookaheadDays), 1, 60),
  };
}

function sanitizeAutoAssignSettings(input: unknown, fallback: AutoAssignSettings): AutoAssignSettings {
  if (!input || typeof input !== "object") return fallback;
  const row = input as Record<string, unknown>;
  return {
    enabled: typeof row.enabled === "boolean" ? row.enabled : fallback.enabled,
    maxDailyJobsPerCleaner: clamp(Number(row.maxDailyJobsPerCleaner ?? fallback.maxDailyJobsPerCleaner), 1, 20),
    weightSuburbHistory: clamp(Number(row.weightSuburbHistory ?? fallback.weightSuburbHistory), 0, 100),
    weightQaScore: clamp(Number(row.weightQaScore ?? fallback.weightQaScore), 0, 100),
    weightCurrentLoad: clamp(Number(row.weightCurrentLoad ?? fallback.weightCurrentLoad), 0, 100),
  };
}

function sanitizeRouteOptimizationSettings(
  input: unknown,
  fallback: RouteOptimizationSettings
): RouteOptimizationSettings {
  if (!input || typeof input !== "object") return fallback;
  const row = input as Record<string, unknown>;
  return {
    enabled: typeof row.enabled === "boolean" ? row.enabled : fallback.enabled,
    groupBySuburb:
      typeof row.groupBySuburb === "boolean" ? row.groupBySuburb : fallback.groupBySuburb,
    maxStopsPerRun: clamp(Number(row.maxStopsPerRun ?? fallback.maxStopsPerRun), 1, 30),
  };
}

function sanitizeQaAutomationSettings(
  input: unknown,
  fallback: QaAutomationSettings
): QaAutomationSettings {
  if (!input || typeof input !== "object") return fallback;
  const row = input as Record<string, unknown>;
  return {
    failureThreshold: clamp(Number(row.failureThreshold ?? fallback.failureThreshold), 0, 100),
    autoCreateReworkJob:
      typeof row.autoCreateReworkJob === "boolean"
        ? row.autoCreateReworkJob
        : fallback.autoCreateReworkJob,
    reworkDelayHours: clamp(Number(row.reworkDelayHours ?? fallback.reworkDelayHours), 1, 168),
    createIssueTicket:
      typeof row.createIssueTicket === "boolean"
        ? row.createIssueTicket
        : fallback.createIssueTicket,
  };
}

function sanitizePropertyFormTemplateOverrides(
  input: unknown,
  fallback: PropertyFormTemplateOverrides
): PropertyFormTemplateOverrides {
  if (!input || typeof input !== "object") return fallback;
  const parsed = input as Record<string, unknown>;
  const output: PropertyFormTemplateOverrides = {};
  const jobTypes = Object.values(JobType);

  for (const [propertyId, rawRow] of Object.entries(parsed)) {
    const propertyKey = String(propertyId ?? "").trim();
    if (!propertyKey) continue;
    if (!rawRow || typeof rawRow !== "object") continue;
    const row = rawRow as Record<string, unknown>;
    const cleanRow: Partial<Record<JobType, string>> = {};

    for (const jobType of jobTypes) {
      const rawTemplateId = row[jobType];
      if (typeof rawTemplateId !== "string") continue;
      const templateId = rawTemplateId.trim();
      if (!templateId) continue;
      cleanRow[jobType] = templateId;
    }

    if (Object.keys(cleanRow).length > 0) {
      output[propertyKey] = cleanRow;
    }
  }

  return output;
}

function sanitizeSettings(input: unknown): AppSettings {
  if (!input || typeof input !== "object") return DEFAULT_SETTINGS;
  const parsed = input as Partial<AppSettings> & {
    profileEditPolicy?: unknown;
    profileEditOverrides?: unknown;
  };

  let profileEditOverrides: Record<string, ProfileEditPolicy> = {};
  if (parsed.profileEditOverrides && typeof parsed.profileEditOverrides === "object") {
    for (const [userId, value] of Object.entries(parsed.profileEditOverrides as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const row = value as Record<string, unknown>;
      profileEditOverrides[userId] = {
        canEditName: typeof row.canEditName === "boolean" ? row.canEditName : true,
        canEditPhone: typeof row.canEditPhone === "boolean" ? row.canEditPhone : true,
        canEditEmail: typeof row.canEditEmail === "boolean" ? row.canEditEmail : false,
      };
    }
  }

  let laundryBagLocationOptions = DEFAULT_SETTINGS.laundryBagLocationOptions;
  if (Array.isArray(parsed.laundryBagLocationOptions)) {
    const cleaned = parsed.laundryBagLocationOptions
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean);
    if (cleaned.length > 0) {
      laundryBagLocationOptions = Array.from(new Set(cleaned));
    }
  }
  if (!laundryBagLocationOptions.includes("Laundry bin")) {
    laundryBagLocationOptions = [...laundryBagLocationOptions, "Laundry bin"];
  }

  let laundryDropoffLocationOptions = DEFAULT_SETTINGS.laundryDropoffLocationOptions;
  if (Array.isArray((parsed as any).laundryDropoffLocationOptions)) {
    const cleaned = (parsed as any).laundryDropoffLocationOptions
      .filter((v: unknown): v is string => typeof v === "string")
      .map((v: string) => v.trim())
      .filter(Boolean);
    if (cleaned.length > 0) {
      laundryDropoffLocationOptions = Array.from(new Set(cleaned));
    }
  }
  if (!laundryDropoffLocationOptions.includes("Laundry bin")) {
    laundryDropoffLocationOptions = [...laundryDropoffLocationOptions, "Laundry bin"];
  }

  let selectAllAllowedCleanerIds = DEFAULT_SETTINGS.selectAllAllowedCleanerIds;
  if (Array.isArray((parsed as any).selectAllAllowedCleanerIds)) {
    const cleaned = (parsed as any).selectAllAllowedCleanerIds
      .filter((v: unknown): v is string => typeof v === "string")
      .map((v: string) => v.trim())
      .filter((v: string) => v.length > 0);
    selectAllAllowedCleanerIds = Array.from(new Set(cleaned));
  }

  const cleanerJobHourlyRates = sanitizeHourlyRates(
    (parsed as any).cleanerJobHourlyRates,
    DEFAULT_SETTINGS.cleanerJobHourlyRates
  );

  return {
    companyName: typeof (parsed as any).companyName === "string" && (parsed as any).companyName.trim()
      ? (parsed as any).companyName.trim()
      : DEFAULT_SETTINGS.companyName,
    projectName: typeof parsed.projectName === "string" && parsed.projectName.trim()
      ? parsed.projectName.trim()
      : DEFAULT_SETTINGS.projectName,
    logoUrl:
      typeof (parsed as any).logoUrl === "string"
        ? (parsed as any).logoUrl.trim()
        : DEFAULT_SETTINGS.logoUrl,
    accountsEmail:
      typeof (parsed as any).accountsEmail === "string" && (parsed as any).accountsEmail.trim()
        ? (parsed as any).accountsEmail.trim()
        : DEFAULT_SETTINGS.accountsEmail,
    timezone: typeof parsed.timezone === "string" && parsed.timezone.trim()
      ? parsed.timezone.trim()
      : DEFAULT_SETTINGS.timezone,
    reminder24hHours: clamp(Number(parsed.reminder24hHours ?? DEFAULT_SETTINGS.reminder24hHours), 1, 168),
    reminder2hHours: clamp(Number(parsed.reminder2hHours ?? DEFAULT_SETTINGS.reminder2hHours), 1, 48),
    cleanerStartRequireDateMatch:
      typeof parsed.cleanerStartRequireDateMatch === "boolean"
        ? parsed.cleanerStartRequireDateMatch
        : DEFAULT_SETTINGS.cleanerStartRequireDateMatch,
    cleanerStartRequireChecklistConfirm:
      typeof parsed.cleanerStartRequireChecklistConfirm === "boolean"
        ? parsed.cleanerStartRequireChecklistConfirm
        : DEFAULT_SETTINGS.cleanerStartRequireChecklistConfirm,
    strictClientAdminOnly:
      typeof (parsed as any).strictClientAdminOnly === "boolean"
        ? (parsed as any).strictClientAdminOnly
        : DEFAULT_SETTINGS.strictClientAdminOnly,
    quoteDefaultValidityDays: clamp(Number(parsed.quoteDefaultValidityDays ?? DEFAULT_SETTINGS.quoteDefaultValidityDays), 1, 90),
    quoteDefaultEmailSubject:
      typeof parsed.quoteDefaultEmailSubject === "string" && parsed.quoteDefaultEmailSubject.trim()
        ? parsed.quoteDefaultEmailSubject.trim()
        : DEFAULT_SETTINGS.quoteDefaultEmailSubject,
    laundryBagLocationOptions,
    laundryDropoffLocationOptions,
    selectAllAllowedCleanerIds,
    cleanerJobHourlyRates,
    profileEditPolicy: sanitizeRolePolicy(parsed.profileEditPolicy, DEFAULT_SETTINGS.profileEditPolicy),
    profileEditOverrides,
    clientPortalVisibility: sanitizeClientPortalVisibility(
      (parsed as any).clientPortalVisibility,
      DEFAULT_SETTINGS.clientPortalVisibility
    ),
    cleanerPortalVisibility: sanitizeCleanerPortalVisibility(
      (parsed as any).cleanerPortalVisibility,
      DEFAULT_SETTINGS.cleanerPortalVisibility
    ),
    laundryPortalVisibility: sanitizeLaundryPortalVisibility(
      (parsed as any).laundryPortalVisibility,
      DEFAULT_SETTINGS.laundryPortalVisibility
    ),
    laundryOperations: sanitizeLaundryOperations(
      (parsed as any).laundryOperations,
      DEFAULT_SETTINGS.laundryOperations
    ),
    sla: sanitizeSlaSettings((parsed as any).sla, DEFAULT_SETTINGS.sla),
    recurringJobs: sanitizeRecurringJobSettings(
      (parsed as any).recurringJobs,
      DEFAULT_SETTINGS.recurringJobs
    ),
    autoAssign: sanitizeAutoAssignSettings((parsed as any).autoAssign, DEFAULT_SETTINGS.autoAssign),
    routeOptimization: sanitizeRouteOptimizationSettings(
      (parsed as any).routeOptimization,
      DEFAULT_SETTINGS.routeOptimization
    ),
    qaAutomation: sanitizeQaAutomationSettings(
      (parsed as any).qaAutomation,
      DEFAULT_SETTINGS.qaAutomation
    ),
    propertyFormTemplateOverrides: sanitizePropertyFormTemplateOverrides(
      (parsed as any).propertyFormTemplateOverrides,
      DEFAULT_SETTINGS.propertyFormTemplateOverrides
    ),
    emailTemplates: sanitizeEmailTemplates(
      (parsed as any).emailTemplates,
      DEFAULT_SETTINGS.emailTemplates
    ),
  };
}

export async function getAppSettings(): Promise<AppSettings> {
  const row = await db.appSetting.findUnique({ where: { key: "app" } });
  if (!row) return DEFAULT_SETTINGS;
  return sanitizeSettings(row.value);
}

export async function saveAppSettings(input: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getAppSettings();
  const merged = sanitizeSettings({
    ...current,
    ...input,
    profileEditPolicy: input.profileEditPolicy ?? current.profileEditPolicy,
    profileEditOverrides: input.profileEditOverrides ?? current.profileEditOverrides,
    sla: input.sla ?? current.sla,
    recurringJobs: input.recurringJobs ?? current.recurringJobs,
    autoAssign: input.autoAssign ?? current.autoAssign,
    routeOptimization: input.routeOptimization ?? current.routeOptimization,
    qaAutomation: input.qaAutomation ?? current.qaAutomation,
    propertyFormTemplateOverrides:
      input.propertyFormTemplateOverrides ?? current.propertyFormTemplateOverrides,
    emailTemplates: input.emailTemplates ?? current.emailTemplates,
  });

  await db.appSetting.upsert({
    where: { key: "app" },
    create: { key: "app", value: merged as any },
    update: { value: merged as any },
  });

  return merged;
}

export async function getProfilePolicyForRole(role: Role): Promise<ProfileEditPolicy> {
  const settings = await getAppSettings();
  return settings.profileEditPolicy[role] ?? DEFAULT_SETTINGS.profileEditPolicy[role];
}

export async function getProfilePolicyForUser(userId: string, role: Role): Promise<ProfileEditPolicy> {
  const settings = await getAppSettings();
  return (
    settings.profileEditOverrides[userId] ??
    settings.profileEditPolicy[role] ??
    DEFAULT_SETTINGS.profileEditPolicy[role]
  );
}

export async function setProfileOverrideForUser(userId: string, policy: ProfileEditPolicy | null) {
  const settings = await getAppSettings();
  const nextOverrides = { ...settings.profileEditOverrides };
  if (policy) {
    nextOverrides[userId] = policy;
  } else {
    delete nextOverrides[userId];
  }
  return saveAppSettings({ profileEditOverrides: nextOverrides });
}
