import type { Metadata } from "next";
import { getAppSettings } from "@/lib/settings";
import { PortalShell } from "@/components/portal/portal-shell";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { DensityShell } from "@/app/_density-shell";
import { ThemeProvider } from "@/lib/theme/context";
import { getThemeForUser } from "@/lib/theme/server";
import { ShortcutCheatsheet } from "@/components/shortcuts/cheatsheet";
import { GlobalShortcutListener } from "@/hooks/use-keyboard-shortcuts";

export const metadata: Metadata = {
  title: { default: "Maintenance", template: "%s | sNeek Maintenance" },
};

export default async function MaintenanceLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole([Role.MAINTENANCE, Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings();
  const companyName = settings.companyName || "sNeek Property Services";
  const themePref = await getThemeForUser(session.user.id);

  return (
    <DensityShell>
      <ThemeProvider initial={themePref}>
        <GlobalShortcutListener />
        <PortalShell
          companyName={companyName}
          logoUrl={settings.logoUrl}
          portalLabel="Maintenance Portal"
          portalTitle="Your repair jobs, on site"
          settingsHref="/maintenance/settings"
          currentUserName={session.user.name}
          currentUserImage={session.user.image}
          portalTheme={settings.portalTheme}
          navItems={[
            { href: "/maintenance", label: "My Jobs", exact: true },
            { href: "/maintenance/history", label: "History" },
            { href: "/maintenance/settings", label: "Profile" },
          ]}
        >
          {children}
        </PortalShell>
        <ShortcutCheatsheet />
      </ThemeProvider>
    </DensityShell>
  );
}
