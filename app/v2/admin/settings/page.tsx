import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
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
} from "lucide-react";
import { CompanySection } from "@/components/v2/admin/settings/company-section";
import { IntegrationsSection } from "@/components/v2/admin/settings/integrations-section";
import { IcalSection } from "@/components/v2/admin/settings/ical-section";
import { GatewaysSection } from "@/components/v2/admin/settings/gateways-section";
import { XeroSection } from "@/components/v2/admin/settings/xero-section";
import { FinanceNotificationsSection } from "@/components/v2/admin/settings/finance-notifications-section";

export const metadata = { title: "Settings · Estate admin" };
export const dynamic = "force-dynamic";

type TabKey =
  | "company"
  | "integrations"
  | "ical-sync"
  | "payment-gateways"
  | "xero"
  | "finance-notifications";

const ALL_TABS: Array<{ key: TabKey; label: string; icon: JSX.Element; adminOnly: boolean }> = [
  { key: "company", label: "Company & brand", icon: <Building2 className="h-4 w-4" />, adminOnly: false },
  { key: "integrations", label: "Integrations", icon: <Plug className="h-4 w-4" />, adminOnly: true },
  { key: "ical-sync", label: "iCal sync", icon: <CalendarCheck className="h-4 w-4" />, adminOnly: true },
  { key: "payment-gateways", label: "Payment gateways", icon: <CreditCard className="h-4 w-4" />, adminOnly: true },
  { key: "xero", label: "Xero", icon: <FileSpreadsheet className="h-4 w-4" />, adminOnly: true },
  { key: "finance-notifications", label: "Finance notifications", icon: <BellRing className="h-4 w-4" />, adminOnly: true },
];

export default async function SettingsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const isAdmin = session.user.role === Role.ADMIN;
  const appSettings = await getAppSettings();

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

      {activeTab === "company" ? (
        <CompanySection
          initial={{
            companyName: appSettings.companyName,
            projectName: appSettings.projectName,
            logoUrl: appSettings.logoUrl,
            reportLogoUrl: appSettings.reportLogoUrl,
            accountsEmail: appSettings.accountsEmail,
            timezone: appSettings.timezone,
            gstEnabled: appSettings.pricing.gstEnabled,
          }}
          readOnly={!isAdmin}
        />
      ) : null}

      {activeTab === "integrations" && isAdmin ? <IntegrationsSection /> : null}
      {activeTab === "ical-sync" && isAdmin ? <IcalSection /> : null}
      {activeTab === "payment-gateways" && isAdmin ? <GatewaysSection /> : null}
      {activeTab === "xero" && isAdmin ? <XeroSection /> : null}
      {activeTab === "finance-notifications" && isAdmin ? <FinanceNotificationsSection /> : null}
    </div>
  );
}
