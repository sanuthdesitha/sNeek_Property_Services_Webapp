import type { Metadata } from "next";
import { getAppSettings } from "@/lib/settings";
import { PortalShell } from "@/components/portal/portal-shell";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";

export const metadata: Metadata = {
  title: { default: "My Jobs", template: "%s | sNeek Property Services Cleaner" },
};

export default async function CleanerLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings();
  const companyName = settings.companyName || "sNeek Property Services";
  const visibility = settings.cleanerPortalVisibility;

  return (
    <PortalShell
      companyName={companyName}
      logoUrl={settings.logoUrl}
      portalLabel="Cleaner Portal"
      portalTitle="Jobs, pay, and field work"
      settingsHref="/cleaner/settings"
      currentUserName={session.user.name}
      currentUserImage={session.user.image}
      portalTheme={settings.portalTheme}
      navItems={[
        { href: "/cleaner", label: "Dashboard", exact: true },
        { href: "/cleaner/hub", label: "Team Hub" },
        { href: "/cleaner/route", label: "Route" },
        ...(visibility.showJobs ? [{ href: "/cleaner/jobs", label: "Jobs" }] : []),
        ...(visibility.showCalendar ? [{ href: "/cleaner/calendar", label: "Calendar" }] : []),
        ...(visibility.showShopping ? [{ href: "/cleaner/shopping", label: "Shopping" }] : []),
        ...(visibility.showStockRuns ? [{ href: "/cleaner/stock-runs", label: "Stock Counts" }] : []),
        { href: "/cleaner/availability", label: "Availability" },
        ...(visibility.showInvoices ? [{ href: "/cleaner/invoices", label: "Invoices" }] : []),
        ...(visibility.showPayRequests ? [{ href: "/cleaner/pay-requests", label: "Pay Requests" }] : []),
        ...(visibility.showLostFound ? [{ href: "/cleaner/lost-found", label: "Lost & Found" }] : []),
      ]}
    >
      {children}
    </PortalShell>
  );
}
