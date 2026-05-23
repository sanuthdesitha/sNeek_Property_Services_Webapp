import { getAppSettings } from "@/lib/settings";
import { PortalShell } from "@/components/portal/portal-shell";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { DensityShell } from "@/app/_density-shell";
import { ThemeProvider } from "@/lib/theme/context";
import { getThemeForUser } from "@/lib/theme/server";
import { ShortcutCheatsheet } from "@/components/shortcuts/cheatsheet";
import { GlobalShortcutListener } from "@/hooks/use-keyboard-shortcuts";

export default async function LaundryLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole([Role.LAUNDRY]);
  const settings = await getAppSettings();
  const companyName = settings.companyName || "sNeek Property Services";
  const visibility = settings.laundryPortalVisibility;
  const themePref = await getThemeForUser(session.user.id);

  return (
    <DensityShell>
      <ThemeProvider initial={themePref}>
        <GlobalShortcutListener />
        <PortalShell
      companyName={companyName}
      logoUrl={settings.logoUrl}
      portalLabel="Laundry Portal"
      portalTitle="Pickups, returns, and laundry costs"
      settingsHref="/laundry/settings"
      currentUserName={session.user.name}
      currentUserImage={session.user.image}
      portalTheme={settings.portalTheme}
      navItems={[
        { href: "/laundry", label: "Dashboard", exact: true },
        { href: "/laundry/hub", label: "Team Hub" },
        ...(visibility.showCalendar ? [{ href: "/laundry/calendar", label: "Calendar" }] : []),
        ...(visibility.showInvoices ? [{ href: "/laundry/invoices", label: "Invoices" }] : []),
      ]}
        >
          {children}
        </PortalShell>
        <ShortcutCheatsheet />
      </ThemeProvider>
    </DensityShell>
  );
}
