import { getAppSettings } from "@/lib/settings";
import { PortalShell } from "@/components/portal/portal-shell";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { getClientPortalContext } from "@/lib/client/portal";
import { DensityShell } from "@/app/_density-shell";
import { ThemeProvider } from "@/lib/theme/context";
import { getThemeForUser } from "@/lib/theme/server";
import { ShortcutCheatsheet } from "@/components/shortcuts/cheatsheet";
import { GlobalShortcutListener } from "@/hooks/use-keyboard-shortcuts";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole([Role.CLIENT]);
  const settings = await getAppSettings();
  const portal = await getClientPortalContext(session.user.id, settings);
  const companyName = settings.companyName || "sNeek Property Services";
  const visibility = portal.visibility;
  const themePref = await getThemeForUser(session.user.id);

  return (
    <DensityShell>
      <ThemeProvider initial={themePref}>
        <GlobalShortcutListener />
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
        // Ordered by client priority: day-to-day service items first, then
        // account/property, then optional inventory/laundry/rewards.
        ...(visibility.showJobs ? [{ href: "/client/jobs", label: "Jobs" }] : []),
        ...(visibility.showCalendar ? [{ href: "/client/calendar", label: "Calendar" }] : []),
        ...(visibility.showBooking ? [{ href: "/client/booking", label: "Booking" }] : []),
        ...(visibility.showReports ? [{ href: "/client/reports", label: "Reports" }] : []),
        ...(visibility.showApprovals ? [{ href: "/client/approvals", label: "Approvals" }] : []),
        { href: "/client/messages", label: "Messages" },
        ...(visibility.showProperties ? [{ href: "/client/properties", label: "Properties" }] : []),
        ...(visibility.showFinanceDetails ? [{ href: "/client/finance", label: "Finance" }] : []),
        { href: "/client/quotes", label: "My quotes" },
        ...(visibility.showQuoteRequests ? [{ href: "/client/quote", label: "Request a quote" }] : []),
        { href: "/client/maintenance", label: "Maintenance" },
        ...(visibility.showCases ? [{ href: "/client/cases", label: "Cases" }] : []),
        ...(visibility.showLaundryUpdates ? [{ href: "/client/laundry", label: "Laundry" }] : []),
        ...(visibility.showInventory ? [{ href: "/client/inventory", label: "Inventory" }] : []),
        ...(visibility.showInventory && visibility.showShopping ? [{ href: "/client/shopping", label: "Shopping" }] : []),
        ...(visibility.showInventory && visibility.showStockRuns && visibility.allowStockRuns
          ? [{ href: "/client/stock-runs", label: "Stock Counts" }]
          : []),
        { href: "/client/referrals", label: "Rewards" },
      ]}
        >
          {children}
        </PortalShell>
        <ShortcutCheatsheet />
      </ThemeProvider>
    </DensityShell>
  );
}
