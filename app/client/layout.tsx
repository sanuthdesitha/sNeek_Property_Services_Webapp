import { getAppSettings } from "@/lib/settings";
import { PortalShell } from "@/components/portal/portal-shell";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const settings = await getAppSettings();
  const companyName = settings.companyName || "sNeek Property Services";
  const visibility = settings.clientPortalVisibility;

  return (
    <PortalShell
      companyName={companyName}
      logoUrl={settings.logoUrl}
      portalLabel="Client Portal"
      portalTitle="Properties, reports, and service updates"
      settingsHref="/client/settings"
      maxWidthClass="max-w-6xl"
      navItems={[
        { href: "/client", label: "Dashboard", exact: true },
        ...(visibility.showCalendar ? [{ href: "/client/calendar", label: "Calendar" }] : []),
        ...(visibility.showInventory ? [{ href: "/client/inventory", label: "Inventory" }] : []),
        ...(visibility.showInventory && visibility.showShopping ? [{ href: "/client/shopping", label: "Shopping" }] : []),
        ...(visibility.showReports ? [{ href: "/client/reports", label: "Reports" }] : []),
        ...(visibility.showQuoteRequests ? [{ href: "/client/quote", label: "Request Quote" }] : []),
        ...(visibility.showApprovals ? [{ href: "/client/approvals", label: "Approvals" }] : []),
        ...(visibility.showApprovals ? [{ href: "/client/disputes", label: "Disputes" }] : []),
      ]}
    >
      {children}
    </PortalShell>
  );
}
