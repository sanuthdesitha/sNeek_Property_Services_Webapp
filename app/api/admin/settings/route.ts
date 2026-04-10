import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings, saveAppSettings } from "@/lib/settings";
import { db } from "@/lib/db";
import { z } from "zod";
import { EMAIL_TEMPLATE_KEYS } from "@/lib/email-templates";
import { NOTIFICATION_TEMPLATE_KEYS } from "@/lib/notification-templates";

const rolePolicySchema = z.object({
  canEditName: z.boolean(),
  canEditPhone: z.boolean(),
  canEditEmail: z.boolean(),
});

const clientPortalVisibilitySchema = z.object({
  showProperties: z.boolean().optional(),
  showJobs: z.boolean().optional(),
  showBooking: z.boolean().optional(),
  showCalendar: z.boolean().optional(),
  showReports: z.boolean().optional(),
  showChecklistPreview: z.boolean().optional(),
  showInventory: z.boolean().optional(),
  showShopping: z.boolean().optional(),
  showStockRuns: z.boolean().optional(),
  showFinanceDetails: z.boolean().optional(),
  showOngoingJobs: z.boolean().optional(),
  showCases: z.boolean().optional(),
  showExtraPayRequests: z.boolean().optional(),
  showCleanerNames: z.boolean().optional(),
  showLaundryUpdates: z.boolean().optional(),
  showLaundryImages: z.boolean().optional(),
  showLaundryCosts: z.boolean().optional(),
  showClientTaskRequests: z.boolean().optional(),
  showQuoteRequests: z.boolean().optional(),
  showApprovals: z.boolean().optional(),
  showReportDownloads: z.boolean().optional(),
  allowInventoryThresholdEdits: z.boolean().optional(),
  allowStockRuns: z.boolean().optional(),
  allowCaseReplies: z.boolean().optional(),
});

const cleanerPortalVisibilitySchema = z.object({
  showJobs: z.boolean().optional(),
  showCalendar: z.boolean().optional(),
  showShopping: z.boolean().optional(),
  showStockRuns: z.boolean().optional(),
  showInvoices: z.boolean().optional(),
  showPayRequests: z.boolean().optional(),
  showLostFound: z.boolean().optional(),
});

const laundryPortalVisibilitySchema = z.object({
  showCalendar: z.boolean().optional(),
  showInvoices: z.boolean().optional(),
  showHistoryTab: z.boolean().optional(),
  showCostTracking: z.boolean().optional(),
  showPickupPhoto: z.boolean().optional(),
  showSkipReasons: z.boolean().optional(),
  requireDropoffPhoto: z.boolean().optional(),
  requireEarlyDropoffReason: z.boolean().optional(),
});

const notificationChannelsSchema = z.object({
  web: z.boolean().optional(),
  email: z.boolean().optional(),
  sms: z.boolean().optional(),
});

const notificationDefaultsSchema = z.object({
  categories: z
    .object({
      account: notificationChannelsSchema.optional(),
      jobs: notificationChannelsSchema.optional(),
      laundry: notificationChannelsSchema.optional(),
      cases: notificationChannelsSchema.optional(),
      reports: notificationChannelsSchema.optional(),
      quotes: notificationChannelsSchema.optional(),
      shopping: notificationChannelsSchema.optional(),
      billing: notificationChannelsSchema.optional(),
      approvals: notificationChannelsSchema.optional(),
    })
    .optional(),
});

const scheduledNotificationsSchema = z.object({
  reminder24hEnabled: z.boolean().optional(),
  reminder2hEnabled: z.boolean().optional(),
  tomorrowPrepEnabled: z.boolean().optional(),
  tomorrowPrepTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  stockAlertsEnabled: z.boolean().optional(),
  stockAlertsTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  adminAttentionSummaryEnabled: z.boolean().optional(),
  adminAttentionSummaryTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  autoApproveLaundrySyncDrafts: z.boolean().optional(),
  laundrySyncNotificationHorizonDays: z.number().int().min(1).max(120).optional(),
});

const autoClockOutSchema = z.object({
  enabled: z.boolean().optional(),
  graceMinutes: z.number().int().min(0).max(240).optional(),
  fallbackAtMidnight: z.boolean().optional(),
  maxJobLengthHours: z.number().int().min(1).max(24).optional(),
});

const laundryOperationsSchema = z.object({
  pickupCutoffTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  defaultPickupTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  defaultDropoffTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  maxOutdoorDays: z.number().int().min(1).max(14).optional(),
  fastReturnWhenNoNextClean: z.boolean().optional(),
  fastReturnDaysWhenNoNextClean: z.number().int().min(1).max(7).optional(),
});

const slaSchema = z.object({
  enabled: z.boolean().optional(),
  warnHoursBeforeDue: z.number().int().min(1).max(72).optional(),
  overdueEscalationMinutes: z.number().int().min(5).max(1440).optional(),
  createIssueOnOverdue: z.boolean().optional(),
  notifyAdminOnOverdue: z.boolean().optional(),
});

const recurringJobsSchema = z.object({
  enabled: z.boolean().optional(),
  lookaheadDays: z.number().int().min(1).max(60).optional(),
});

const autoAssignSchema = z.object({
  enabled: z.boolean().optional(),
  maxDailyJobsPerCleaner: z.number().int().min(1).max(20).optional(),
  weightSuburbHistory: z.number().min(0).max(100).optional(),
  weightQaScore: z.number().min(0).max(100).optional(),
  weightCurrentLoad: z.number().min(0).max(100).optional(),
});

const routeOptimizationSchema = z.object({
  enabled: z.boolean().optional(),
  groupBySuburb: z.boolean().optional(),
  maxStopsPerRun: z.number().int().min(1).max(30).optional(),
});

const qaAutomationSchema = z.object({
  failureThreshold: z.number().min(0).max(100).optional(),
  autoCreateReworkJob: z.boolean().optional(),
  reworkDelayHours: z.number().int().min(1).max(168).optional(),
  createIssueTicket: z.boolean().optional(),
});

const pricingSchema = z.object({
  gstEnabled: z.boolean().optional(),
});

const updateSchema = z.object({
  companyName: z.string().trim().min(1).optional(),
  projectName: z.string().trim().min(1).optional(),
  logoUrl: z.string().trim().optional(),
  accountsEmail: z.string().trim().email().optional(),
  timezone: z.string().trim().min(1).optional(),
  websiteContent: z.any().optional(),
  smsProvider: z.enum(["none", "twilio", "cellcast"]).optional(),
  reminder24hHours: z.number().int().min(1).max(168).optional(),
  reminder2hHours: z.number().int().min(1).max(48).optional(),
  cleanerStartRequireDateMatch: z.boolean().optional(),
  cleanerStartRequireChecklistConfirm: z.boolean().optional(),
  strictClientAdminOnly: z.boolean().optional(),
  quoteDefaultValidityDays: z.number().int().min(1).max(90).optional(),
  quoteDefaultEmailSubject: z.string().trim().min(1).optional(),
  laundryBagLocationOptions: z.array(z.string().trim().min(1)).min(1).optional(),
  laundryDropoffLocationOptions: z.array(z.string().trim().min(1)).min(1).optional(),
  selectAllAllowedCleanerIds: z.array(z.string().trim().min(1)).optional(),
  cleanerJobHourlyRates: z.record(z.record(z.number().min(0).max(1000))).optional(),
  profileEditPolicy: z
    .object({
      ADMIN: rolePolicySchema.optional(),
      OPS_MANAGER: rolePolicySchema.optional(),
      CLEANER: rolePolicySchema.optional(),
      CLIENT: rolePolicySchema.optional(),
      LAUNDRY: rolePolicySchema.optional(),
    })
    .optional(),
  profileEditOverrides: z.record(rolePolicySchema).optional(),
  clientPortalVisibility: clientPortalVisibilitySchema.optional(),
  cleanerPortalVisibility: cleanerPortalVisibilitySchema.optional(),
  laundryPortalVisibility: laundryPortalVisibilitySchema.optional(),
  notificationDefaults: notificationDefaultsSchema.optional(),
  scheduledNotifications: scheduledNotificationsSchema.optional(),
  autoClockOut: autoClockOutSchema.optional(),
  laundryOperations: laundryOperationsSchema.optional(),
  sla: slaSchema.optional(),
  recurringJobs: recurringJobsSchema.optional(),
  autoAssign: autoAssignSchema.optional(),
  routeOptimization: routeOptimizationSchema.optional(),
  qaAutomation: qaAutomationSchema.optional(),
  pricing: pricingSchema.optional(),
  emailTemplates: z
    .record(
      z.enum(EMAIL_TEMPLATE_KEYS as [string, ...string[]]),
      z.object({
        subject: z.string().trim().min(1),
        html: z.string().trim().min(1),
      })
    )
    .optional(),
  notificationTemplates: z
    .record(
      z.enum(NOTIFICATION_TEMPLATE_KEYS as [string, ...string[]]),
      z.object({
        webSubject: z.string().trim().min(1),
        webBody: z.string().trim().min(1),
        smsBody: z.string().trim().min(1),
      })
    )
    .optional(),
});

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const settings = await getAppSettings();
    return NextResponse.json(settings);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const body = updateSchema.parse(await req.json());
    const before = await getAppSettings();
    const settings = await saveAppSettings(body as any);

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "SETTINGS_UPDATE",
        entity: "AppSettings",
        entityId: "app",
        before: before as any,
        after: settings as any,
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null,
      },
    });

    return NextResponse.json(settings);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
