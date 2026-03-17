import type { Metadata } from "next";
import { getAppSettings } from "@/lib/settings";
import { PortalShell } from "@/components/portal/portal-shell";

export const metadata: Metadata = {
  title: { default: "My Jobs", template: "%s | sNeek Property Services Cleaner" },
};

export default async function CleanerLayout({ children }: { children: React.ReactNode }) {
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
      maxWidthClass="max-w-5xl"
      navItems={[
        { href: "/cleaner", label: "Dashboard", exact: true },
        ...(visibility.showJobs ? [{ href: "/cleaner/jobs", label: "Jobs" }] : []),
        ...(visibility.showCalendar ? [{ href: "/cleaner/calendar", label: "Calendar" }] : []),
        ...(visibility.showShopping ? [{ href: "/cleaner/shopping", label: "Shopping" }] : []),
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
