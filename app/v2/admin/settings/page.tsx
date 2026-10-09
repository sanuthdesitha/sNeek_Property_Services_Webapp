import { SettingsNavigation } from "@/components/v2/admin/settings/settings-navigation";
import { availableSettings } from "@/components/v2/admin/settings/settings-catalog";
import { HolidayRatesWorkspace } from "@/components/finance/holiday-rates-workspace";
import { PropertyFormEditor } from "@/components/v2/admin/settings/property-form-editor";
import { getPropertyFormConfig } from "@/lib/property-form/config-store";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import Link from "next/link";
import { getAppSettings } from "@/lib/settings";
import { CompanySection } from "@/components/v2/admin/settings/company-section";
import { BankSection } from "@/components/v2/admin/settings/bank-section";
import { InvoiceNumberingSection } from "@/components/v2/admin/settings/invoice-numbering-section";
import { SafeguardsSection } from "@/components/v2/admin/settings/safeguards-section";
import { NotificationsAutomationSection } from "@/components/v2/admin/settings/notifications-automation-section";
import { RatesSection } from "@/components/v2/admin/settings/rates-section";
import { PricingVariablesSection } from "@/components/v2/admin/settings/pricing-variables-section";
import { PortalsSection } from "@/components/v2/admin/settings/portals-section";
import { LookSection } from "@/components/v2/admin/settings/look-section";
import { LaundrySection } from "@/components/v2/admin/settings/laundry-section";
import { PublicWidgetsSection } from "@/components/v2/admin/settings/public-widgets-section";
import { ProfilePermissionsSection } from "@/components/v2/admin/settings/profile-permissions-section";
import { IntegrationsSection } from "@/components/v2/admin/settings/integrations-section";
import { IcalSection } from "@/components/v2/admin/settings/ical-section";
import { GatewaysSection } from "@/components/v2/admin/settings/gateways-section";
import { OllamaSection } from "@/components/v2/admin/settings/ollama-section";
import { XeroSection } from "@/components/v2/admin/settings/xero-section";
import { FinanceNotificationsSection } from "@/components/v2/admin/settings/finance-notifications-section";
import { OverviewSection } from "@/components/v2/admin/settings/overview-section";
import { NotificationToolsSection } from "@/components/v2/admin/settings/notification-tools-section";
import { RolesSection } from "@/components/v2/admin/settings/roles-section";
import { AuditSection } from "@/components/v2/admin/settings/audit-section";
import { AccountabilitySection } from "@/components/v2/admin/settings/accountability-section";
import { FinalCheckupSettingsSection } from "@/components/v2/admin/settings/final-checkup-settings";
import { NoPhotoSection } from "@/components/v2/admin/settings/no-photo-section";
import { NotificationAudienceSection } from "@/components/v2/admin/settings/notification-audience-section";

export const metadata = { title: "Settings · Estate admin" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { tab?: string; jobId?: string };
}) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const isAdmin = session.user.role === Role.ADMIN;
  const appSettings = await getAppSettings();
  const cleaners = await db.user.findMany({
    where: { role: Role.CLEANER, isActive: true },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });

  const availableTabs = availableSettings(isAdmin);
  const requested = availableTabs.find((t) => t.key === searchParams.tab)?.key;
  const activeTab = requested ?? "overview";
  const propertyFormConfig =
    activeTab === "property-form" ? await getPropertyFormConfig() : null;

  return (
    <div className="min-w-0 space-y-6">
      <EPageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Find the right setting, then make changes in one place."
      />

      <SettingsNavigation
        key={activeTab}
        sections={availableTabs}
        activeTab={activeTab}
      />

      {activeTab === "holiday-rates" && isAdmin ? (
        <section aria-labelledby="holiday-rates-heading" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="holiday-rates-heading" className="text-lg font-semibold">
              Public holiday rates
            </h2>
            {searchParams.jobId ? (
              <EButton asChild variant="outline" className="min-h-11">
                <Link
                  href={`/v2/admin/jobs/${encodeURIComponent(searchParams.jobId)}?tab=money`}
                >
                  Back to job
                </Link>
              </EButton>
            ) : null}
          </div>
          <p className="text-sm text-[hsl(var(--e-muted-foreground))]">
            Configure holiday rates and review a job adjustment before applying
            it.
          </p>
          <HolidayRatesWorkspace
            key={searchParams.jobId ?? ""}
            panel
            initialJobId={searchParams.jobId ?? ""}
          />
        </section>
      ) : null}
      {activeTab === "property-form" && propertyFormConfig ? (
        <section aria-labelledby="property-form-heading" className="space-y-3">
          <h2 id="property-form-heading" className="text-lg font-semibold">
            Property form
          </h2>
          <PropertyFormEditor initialConfig={propertyFormConfig} />
        </section>
      ) : null}

      {activeTab === "ollama" && isAdmin ? <OllamaSection /> : null}
      {activeTab === "overview" ? (
        <OverviewSection
          settings={{
            companyName: appSettings.companyName,
            projectName: appSettings.projectName,
            accountsEmail: appSettings.accountsEmail,
            timezone: appSettings.timezone,
            smsProvider: appSettings.smsProvider,
            gstEnabled: appSettings.pricing.gstEnabled,
          }}
        />
      ) : null}

      {activeTab === "look" && isAdmin ? (
        <LookSection
          initial={appSettings.defaultPortalVersion}
          readOnly={!isAdmin}
        />
      ) : null}

      {activeTab === "company" ? (
        <CompanySection
          initial={{
            companyName: appSettings.companyName,
            companyPhone: appSettings.companyPhone,
            cleanerClientContact: appSettings.cleanerClientContact,
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
            defaultPaymentTermsDays:
              appSettings.invoicing.defaultPaymentTermsDays,
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

      {/* Sits under the bank details on purpose: what an invoice is CALLED is
          part of the same invoice setup as the account it asks to be paid into,
          and the payment note above already tells clients to quote that number. */}
      {activeTab === "bank" && isAdmin ? <InvoiceNumberingSection /> : null}

      {activeTab === "safeguards" && isAdmin ? (
        <SafeguardsSection
          initial={{
            cleanerStartRequireDateMatch:
              appSettings.cleanerStartRequireDateMatch,
            cleanerStartRequireChecklistConfirm:
              appSettings.cleanerStartRequireChecklistConfirm,
            strictClientAdminOnly: appSettings.strictClientAdminOnly,
            inputHistorySuggestionsEnabled:
              appSettings.inputHistorySuggestionsEnabled,
            autoClockOut: {
              enabled: appSettings.autoClockOut.enabled,
              stopAtEstimatedDuration:
                appSettings.autoClockOut.stopAtEstimatedDuration,
              graceMinutes: appSettings.autoClockOut.graceMinutes,
              fallbackAtMidnight: appSettings.autoClockOut.fallbackAtMidnight,
              maxJobLengthHours: appSettings.autoClockOut.maxJobLengthHours,
              geofenceExit: appSettings.autoClockOut.geofenceExit,
            },
            sla: {
              enabled: appSettings.sla.enabled,
              warnHoursBeforeDue: appSettings.sla.warnHoursBeforeDue,
              overdueEscalationMinutes:
                appSettings.sla.overdueEscalationMinutes,
            },
            recurringJobs: {
              enabled: appSettings.recurringJobs.enabled,
              lookaheadDays: appSettings.recurringJobs.lookaheadDays,
            },
            autoAssign: {
              enabled: appSettings.autoAssign.enabled,
              maxDailyJobsPerCleaner:
                appSettings.autoAssign.maxDailyJobsPerCleaner,
            },
            qaAutomation: {
              autoCreateReworkJob: appSettings.qaAutomation.autoCreateReworkJob,
              failureThreshold: appSettings.qaAutomation.failureThreshold,
              reworkDelayHours: appSettings.qaAutomation.reworkDelayHours,
              autoScoreEnabled: appSettings.qaAutomation.autoScoreEnabled,
              autoScoreAfterHours: appSettings.qaAutomation.autoScoreAfterHours,
            },
            qaPay: {
              defaultMode: appSettings.qaPay.defaultMode,
              defaultFixedAmount: appSettings.qaPay.defaultFixedAmount,
              defaultHourlyRate: appSettings.qaPay.defaultHourlyRate,
              defaultHoursPerInspection:
                appSettings.qaPay.defaultHoursPerInspection,
              transportAllowancePerDay:
                appSettings.qaPay.transportAllowancePerDay,
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

      {activeTab === "message-channels" && isAdmin ? (
        <NotificationAudienceSection
          initial={appSettings.notificationAudienceControls}
          readOnly={!isAdmin}
        />
      ) : null}

      {activeTab === "rates" && isAdmin ? (
        <RatesSection
          cleaners={cleaners}
          initialRates={
            appSettings.cleanerJobHourlyRates as Record<
              string,
              Record<string, number>
            >
          }
          readOnly={!isAdmin}
        />
      ) : null}

      {activeTab === "pricing-variables" && isAdmin ? (
        <PricingVariablesSection
          initial={appSettings.pricingVariables}
          readOnly={!isAdmin}
        />
      ) : null}

      {activeTab === "accountability" && isAdmin ? (
        <>
          <AccountabilitySection
            initial={appSettings.accountability}
            readOnly={!isAdmin}
          />
          {/* Final check-up (R7) — the pre-submit acknowledgement dialog config
              lives beside the other cleaner-submission gates. */}
          <FinalCheckupSettingsSection
            initial={appSettings.finalCheckup}
            readOnly={!isAdmin}
          />
          {/* "No photo taken" exemption roster — same concern family: what a
              cleaner may skip at submission and what it costs them. */}
          <NoPhotoSection
            initial={appSettings.noPhotoExemptCleanerIds}
            readOnly={!isAdmin}
          />
        </>
      ) : null}

      {activeTab === "portals" && isAdmin ? (
        <PortalsSection
          initial={{
            clientPortalVisibility:
              appSettings.clientPortalVisibility as unknown as Record<
                string,
                boolean
              >,
            cleanerPortalVisibility:
              appSettings.cleanerPortalVisibility as unknown as Record<
                string,
                boolean
              >,
          }}
          readOnly={!isAdmin}
        />
      ) : null}

      {activeTab === "laundry" && isAdmin ? (
        <LaundrySection
          initial={{
            laundryPortalVisibility:
              appSettings.laundryPortalVisibility as unknown as Record<
                string,
                boolean
              >,
            laundryOperations: appSettings.laundryOperations,
            laundryBagLocationOptions: appSettings.laundryBagLocationOptions,
            laundryDropoffLocationOptions:
              appSettings.laundryDropoffLocationOptions,
          }}
          readOnly={!isAdmin}
        />
      ) : null}

      {activeTab === "public-widgets" && isAdmin ? (
        <PublicWidgetsSection
          initial={
            appSettings.publicWidgets as unknown as Record<string, boolean>
          }
          readOnly={!isAdmin}
        />
      ) : null}

      {activeTab === "profile-permissions" && isAdmin ? (
        <ProfilePermissionsSection
          initial={
            appSettings.profileEditPolicy as unknown as Record<
              string,
              {
                canEditName: boolean;
                canEditPhone: boolean;
                canEditEmail: boolean;
              }
            >
          }
          readOnly={!isAdmin}
        />
      ) : null}

      {activeTab === "integrations" && isAdmin ? <IntegrationsSection /> : null}
      {activeTab === "ical-sync" && isAdmin ? <IcalSection /> : null}
      {activeTab === "payment-gateways" && isAdmin ? <GatewaysSection /> : null}
      {activeTab === "xero" && isAdmin ? <XeroSection /> : null}
      {activeTab === "finance-notifications" && isAdmin ? (
        <FinanceNotificationsSection />
      ) : null}
      {activeTab === "notification-tools" ? (
        <NotificationToolsSection isAdmin={isAdmin} />
      ) : null}
      {activeTab === "roles" && isAdmin ? (
        <RolesSection isAdmin={isAdmin} />
      ) : null}
      {activeTab === "audit" && isAdmin ? (
        <AuditSection isAdmin={isAdmin} />
      ) : null}
    </div>
  );
}
