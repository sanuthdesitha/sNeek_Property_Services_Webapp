import { getAppSettings } from "@/lib/settings";
import { PortalShell } from "@/components/portal/portal-shell";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";

export default async function LaundryLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole([Role.LAUNDRY]);
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
      currentUserName={session.user.name}
      currentUserImage={session.user.image}
      hideHeaderOnScroll
      navItems={[
        { href: "/laundry", label: "Dashboard", exact: true },
        { href: "/laundry/hub", label: "Team Hub" },
        ...(visibility.showCalendar ? [{ href: "/laundry/calendar", label: "Calendar" }] : []),
        ...(visibility.showInvoices ? [{ href: "/laundry/invoices", label: "Invoices" }] : []),
      ]}
    >
      {children}
    </PortalShell>
  );
}
