import { getAppSettings } from "@/lib/settings";
import { PortalShell } from "@/components/portal/portal-shell";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole([Role.CLIENT]);
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
      currentUserName={session.user.name}
      currentUserImage={session.user.image}
      navItems={[
        { href: "/client", label: "Dashboard", exact: true },
        ...(visibility.showCalendar ? [{ href: "/client/calendar", label: "Calendar" }] : []),
        ...(visibility.showInventory ? [{ href: "/client/inventory", label: "Inventory" }] : []),
        ...(visibility.showInventory && visibility.showShopping ? [{ href: "/client/shopping", label: "Shopping" }] : []),
        ...(visibility.showInventory && visibility.showStockRuns && visibility.allowStockRuns
          ? [{ href: "/client/stock-runs", label: "Stock Counts" }]
          : []),
        ...(visibility.showFinanceDetails ? [{ href: "/client/finance", label: "Finance" }] : []),
        ...(visibility.showReports ? [{ href: "/client/reports", label: "Reports" }] : []),
        ...(visibility.showQuoteRequests ? [{ href: "/client/quote", label: "Quotes" }] : []),
        ...(visibility.showApprovals ? [{ href: "/client/approvals", label: "Approvals" }] : []),
        ...(visibility.showCases ? [{ href: "/client/cases", label: "Cases" }] : []),
      ]}
    >
      {children}
    </PortalShell>
  );
}
