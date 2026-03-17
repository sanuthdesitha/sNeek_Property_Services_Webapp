import { getAppSettings } from "@/lib/settings";
import { PortalShell } from "@/components/portal/portal-shell";

export default async function LaundryLayout({ children }: { children: React.ReactNode }) {
  const settings = await getAppSettings();
  const companyName = settings.companyName || "sNeek Property Services";
  const visibility = settings.laundryPortalVisibility;

  return (
    <PortalShell
      companyName={companyName}
      logoUrl={settings.logoUrl}
      portalLabel="Laundry Portal"
      portalTitle="Pickups, returns, and laundry costs"
      settingsHref="/laundry/settings"
      maxWidthClass="max-w-6xl"
      navItems={[
        { href: "/laundry", label: "Dashboard", exact: true },
        ...(visibility.showCalendar ? [{ href: "/laundry/calendar", label: "Calendar" }] : []),
        ...(visibility.showInvoices ? [{ href: "/laundry/invoices", label: "Invoices" }] : []),
      ]}
    >
      {children}
    </PortalShell>
  );
}
