import { getAppSettings } from "@/lib/settings";
import { PortalShell } from "@/components/portal/portal-shell";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { getClientPortalContext } from "@/lib/client/portal";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole([Role.CLIENT]);
  const settings = await getAppSettings();
  const portal = await getClientPortalContext(session.user.id, settings);
  const companyName = settings.companyName || "sNeek Property Services";
  const visibility = portal.visibility;

  return (
    <PortalShell
      companyName={companyName}
      logoUrl={settings.logoUrl}
      portalLabel="Client Portal"
      portalTitle="Properties, reports, and service updates"
      settingsHref="/client/settings"
      currentUserName={session.user.name}
      currentUserImage={session.user.image}
      portalTheme={settings.portalTheme}
      navItems={[
        { href: "/client", label: "Dashboard", exact: true },
        ...(visibility.showProperties ? [{ href: "/client/properties", label: "Properties" }] : []),
        ...(visibility.showJobs ? [{ href: "/client/jobs", label: "Jobs" }] : []),
        ...(visibility.showBooking ? [{ href: "/client/booking", label: "Booking" }] : []),
        ...(visibility.showCalendar ? [{ href: "/client/calendar", label: "Calendar" }] : []),
        ...(visibility.showLaundryUpdates ? [{ href: "/client/laundry", label: "Laundry" }] : []),
        ...(visibility.showInventory ? [{ href: "/client/inventory", label: "Inventory" }] : []),
        ...(visibility.showInventory && visibility.showShopping ? [{ href: "/client/shopping", label: "Shopping" }] : []),
        ...(visibility.showInventory && visibility.showStockRuns && visibility.allowStockRuns
          ? [{ href: "/client/stock-runs", label: "Stock Counts" }]
          : []),
        ...(visibility.showFinanceDetails ? [{ href: "/client/finance", label: "Finance" }] : []),
        { href: "/client/messages", label: "Messages" },
        { href: "/client/referrals", label: "Rewards" },
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
