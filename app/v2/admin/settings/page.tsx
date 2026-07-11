import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { EChipTabs } from "@/components/v2/admin/estate-kit";
import { getAppSettings } from "@/lib/settings";
import {
  Building2,
  Plug,
  CalendarCheck,
  CreditCard,
  FileSpreadsheet,
  BellRing,
  Landmark,
  ShieldCheck,
  DollarSign,
  SlidersHorizontal,
  Eye,
  Shirt,
  Globe,
  UserCog,
  LayoutGrid,
  Send,
  KeyRound,
  History,
} from "lucide-react";
import { CompanySection } from "@/components/v2/admin/settings/company-section";
import { BankSection } from "@/components/v2/admin/settings/bank-section";
import { SafeguardsSection } from "@/components/v2/admin/settings/safeguards-section";
import { NotificationsAutomationSection } from "@/components/v2/admin/settings/notifications-automation-section";
import { RatesSection } from "@/components/v2/admin/settings/rates-section";
import { PricingVariablesSection } from "@/components/v2/admin/settings/pricing-variables-section";
import { PortalsSection } from "@/components/v2/admin/settings/portals-section";
import { LaundrySection } from "@/components/v2/admin/settings/laundry-section";
import { PublicWidgetsSection } from "@/components/v2/admin/settings/public-widgets-section";
import { ProfilePermissionsSection } from "@/components/v2/admin/settings/profile-permissions-section";
import { IntegrationsSection } from "@/components/v2/admin/settings/integrations-section";
import { IcalSection } from "@/components/v2/admin/settings/ical-section";
import { GatewaysSection } from "@/components/v2/admin/settings/gateways-section";
import { XeroSection } from "@/components/v2/admin/settings/xero-section";
import { FinanceNotificationsSection } from "@/components/v2/admin/settings/finance-notifications-section";
import { OverviewSection } from "@/components/v2/admin/settings/overview-section";
import { NotificationToolsSection } from "@/components/v2/admin/settings/notification-tools-section";
import { RolesSection } from "@/components/v2/admin/settings/roles-section";
import { AuditSection } from "@/components/v2/admin/settings/audit-section";

export const metadata = { title: "Settings · Estate admin" };
export const dynamic = "force-dynamic";

type TabKey =
  | "overview"
  | "company"
  | "bank"
  | "safeguards"
  | "notifications"
  | "rates"
  | "pricing-variables"
  | "portals"
  | "laundry"
  | "public-widgets"
  | "profile-permissions"
  | "integrations"
  | "ical-sync"
  | "payment-gateways"
  | "xero"
  | "finance-notifications"
  | "notification-tools"
  | "roles"
  | "audit";

const ALL_TABS: Array<{ key: TabKey; label: string; icon: JSX.Element; adminOnly: boolean }> = [
  { key: "overview", label: "Overview", icon: <LayoutGrid className="h-4 w-4" />, adminOnly: false },
  { key: "company", label: "Company & brand", icon: <Building2 className="h-4 w-4" />, adminOnly: false },
  { key: "bank", label: "Bank & payment", icon: <Landmark className="h-4 w-4" />, adminOnly: false },
  { key: "safeguards", label: "Operational safeguards", icon: <ShieldCheck className="h-4 w-4" />, adminOnly: true },
  { key: "notifications", label: "Scheduled notifications", icon: <BellRing className="h-4 w-4" />, adminOnly: true },
  { key: "rates", label: "Cleaner rates", icon: <DollarSign className="h-4 w-4" />, adminOnly: true },
  { key: "pricing-variables", label: "Pricing variables", icon: <SlidersHorizontal className="h-4 w-4" />, adminOnly: true },
  { key: "portals", label: "Portal visibility", icon: <Eye className="h-4 w-4" />, adminOnly: true },
  { key: "laundry", label: "Laundry & locations", icon: <Shirt className="h-4 w-4" />, adminOnly: true },
  { key: "public-widgets", label: "Public site widgets", icon: <Globe className="h-4 w-4" />, adminOnly: true },
  { key: "profile-permissions", label: "Profile permissions", icon: <UserCog className="h-4 w-4" />, adminOnly: true },
  { key: "integrations", label: "Integrations", icon: <Plug className="h-4 w-4" />, adminOnly: true },
  { key: "ical-sync", label: "iCal sync", icon: <CalendarCheck className="h-4 w-4" />, adminOnly: true },
  { key: "payment-gateways", label: "Payment gateways", icon: <CreditCard className="h-4 w-4" />, adminOnly: true },
  { key: "xero", label: "Xero", icon: <FileSpreadsheet className="h-4 w-4" />, adminOnly: true },
  { key: "finance-notifications", label: "Finance notifications", icon: <BellRing className="h-4 w-4" />, adminOnly: true },
  { key: "notification-tools", label: "Notification tools", icon: <Send className="h-4 w-4" />, adminOnly: false },
  { key: "roles", label: "Roles & permissions", icon: <KeyRound className="h-4 w-4" />, adminOnly: true },
  { key: "audit", label: "Audit log", icon: <History className="h-4 w-4" />, adminOnly: true },
];

export default async function SettingsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const isAdmin = session.user.role === Role.ADMIN;
  const appSettings = await getAppSettings();
  const cleaners = await db.user.findMany({
    where: { role: Role.CLEANER, isActive: true },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });

  const availableTabs = ALL_TABS.filter((t) => isAdmin || !t.adminOnly);
  const requested = availableTabs.find((t) => t.key === searchParams.tab)?.key;
  const activeTab: TabKey = requested ?? availableTabs[0]!.key;

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Grouped operational settings with integrations and API credentials."
      />

      <EChipTabs
        tabs={availableTabs.map((t) => ({
          key: t.key,
          label: t.label,
          icon: t.icon,
          href: `/v2/admin/settings?tab=${t.key}`,
          active: t.key === activeTab,
        }))}
      />

      {activeTab === "overview" ? <OverviewSection isAdmin={isAdmin} /> : null}

      {activeTab === "company" ? (
        <CompanySection
          initial={{
            companyName: appSettings.companyName,
            projectName: appSettings.projectName,
            logoUrl: appSettings.logoUrl,
            logoDarkBgUrl: appSettings.logoDarkBgUrl,
            reportLogoUrl: appSettings.reportLogoUrl,
            accountsEmail: appSettings.accountsEmail,
            timezone: appSettings.timezone,
            gstEnabled: appSettings.pricing.gstEnabled,
            quoteDefaultEmailSubject: appSettings.quoteDefaultEmailSubject,
            quoteDefaultValidityDays: appSettings.quoteDefaultValidityDays,
          }}
          readOnly={!isAdmin}
        />
      ) : null}

      {activeTab === "bank" ? (
        <BankSection
          initial={{
            accountsEmail: appSettings.accountsEmail,
            defaultPaymentTermsDays: appSettings.invoicing.defaultPaymentTermsDays,
            abn: appSettings.invoicing.abn,
            bankName: appSettings.invoicing.bankName,
            bankBsb: appSettings.invoicing.bankBsb,
            bankAccountNumber: appSettings.invoicing.bankAccountNumber,
            bankAccountName: appSettings.invoicing.bankAccountName,
            companyAddress: appSettings.invoicing.companyAddress,
            paymentNote: appSettings.invoicing.paymentNote,
          }}
          readOnly={!isAdmin}
        />
      ) : null}

      {activeTab === "safeguards" && isAdmin ? (
        <SafeguardsSection
          initial={{
            cleanerStartRequireDateMatch: appSettings.cleanerStartRequireDateMatch,
            cleanerStartRequireChecklistConfirm: appSettings.cleanerStartRequireChecklistConfirm,
            strictClientAdminOnly: appSettings.strictClientAdminOnly,
            inputHistorySuggestionsEnabled: appSettings.inputHistorySuggestionsEnabled,
            autoClockOut: {
              enabled: appSettings.autoClockOut.enabled,
              stopAtEstimatedDuration: appSettings.autoClockOut.stopAtEstimatedDuration,
              graceMinutes: appSettings.autoClockOut.graceMinutes,
              fallbackAtMidnight: appSettings.autoClockOut.fallbackAtMidnight,
              maxJobLengthHours: appSettings.autoClockOut.maxJobLengthHours,
            },
            sla: {
              enabled: appSettings.sla.enabled,
              warnHoursBeforeDue: appSettings.sla.warnHoursBeforeDue,
              overdueEscalationMinutes: appSettings.sla.overdueEscalationMinutes,
            },
            recurringJobs: {
              enabled: appSettings.recurringJobs.enabled,
              lookaheadDays: appSettings.recurringJobs.lookaheadDays,
            },
            autoAssign: {
              enabled: appSettings.autoAssign.enabled,
              maxDailyJobsPerCleaner: appSettings.autoAssign.maxDailyJobsPerCleaner,
            },
            qaAutomation: {
              autoCreateReworkJob: appSettings.qaAutomation.autoCreateReworkJob,
              failureThreshold: appSettings.qaAutomation.failureThreshold,
              reworkDelayHours: appSettings.qaAutomation.reworkDelayHours,
            },
            evidenceStamp: {
              dateFormat: appSettings.evidenceStamp.dateFormat,
              timeFormat: appSettings.evidenceStamp.timeFormat,
              showWeekday: appSettings.evidenceStamp.showWeekday,
            },
          }}
          readOnly={!isAdmin}
        />
      ) : null}

      {activeTab === "notifications" && isAdmin ? (
        <NotificationsAutomationSection
          initial={{
            scheduledNotifications: appSettings.scheduledNotifications,
            notificationDefaults: {
              categories: appSettings.notificationDefaults.categories as Record<
                string,
                { web?: boolean; email?: boolean; sms?: boolean }
              >,
            },
          }}
          readOnly={!isAdmin}
        />
      ) : null}

      {activeTab === "rates" && isAdmin ? (
        <RatesSection
          cleaners={cleaners}
          initialRates={appSettings.cleanerJobHourlyRates as Record<string, Record<string, number>>}
          readOnly={!isAdmin}
        />
      ) : null}

      {activeTab === "pricing-variables" && isAdmin ? (
        <PricingVariablesSection initial={appSettings.pricingVariables} readOnly={!isAdmin} />
      ) : null}

      {activeTab === "portals" && isAdmin ? (
        <PortalsSection
          initial={{
            clientPortalVisibility: appSettings.clientPortalVisibility as unknown as Record<string, boolean>,
            cleanerPortalVisibility: appSettings.cleanerPortalVisibility as unknown as Record<string, boolean>,
          }}
          readOnly={!isAdmin}
        />
      ) : null}

      {activeTab === "laundry" && isAdmin ? (
        <LaundrySection
          initial={{
            laundryPortalVisibility: appSettings.laundryPortalVisibility as unknown as Record<string, boolean>,
            laundryOperations: appSettings.laundryOperations,
            laundryBagLocationOptions: appSettings.laundryBagLocationOptions,
            laundryDropoffLocationOptions: appSettings.laundryDropoffLocationOptions,
          }}
          readOnly={!isAdmin}
        />
      ) : null}

      {activeTab === "public-widgets" && isAdmin ? (
        <PublicWidgetsSection
          initial={appSettings.publicWidgets as unknown as Record<string, boolean>}
          readOnly={!isAdmin}
        />
      ) : null}

      {activeTab === "profile-permissions" && isAdmin ? (
        <ProfilePermissionsSection
          initial={appSettings.profileEditPolicy as unknown as Record<
            string,
            { canEditName: boolean; canEditPhone: boolean; canEditEmail: boolean }
          >}
          readOnly={!isAdmin}
        />
      ) : null}

      {activeTab === "integrations" && isAdmin ? <IntegrationsSection /> : null}
      {activeTab === "ical-sync" && isAdmin ? <IcalSection /> : null}
      {activeTab === "payment-gateways" && isAdmin ? <GatewaysSection /> : null}
      {activeTab === "xero" && isAdmin ? <XeroSection /> : null}
      {activeTab === "finance-notifications" && isAdmin ? <FinanceNotificationsSection /> : null}
      {activeTab === "notification-tools" ? <NotificationToolsSection isAdmin={isAdmin} /> : null}
      {activeTab === "roles" && isAdmin ? <RolesSection isAdmin={isAdmin} /> : null}
      {activeTab === "audit" && isAdmin ? <AuditSection isAdmin={isAdmin} /> : null}
    </div>
  );
}
