import type { Metadata } from "next";
import { Role } from "@prisma/client";
import { PortalShell } from "@/components/portal/portal-shell";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: { default: "QA Inspections", template: "%s | sNeek QA" },
};

export default async function QaLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole([Role.QA_INSPECTOR, Role.OPS_MANAGER, Role.ADMIN]);
  const settings = await getAppSettings();

  // Only ADMIN / OPS_MANAGER can open the admin console — a pure QA inspector
  // hitting /admin is bounced to /unauthorized, so don't show them the link.
  const canOpenAdmin =
    session.user.role === Role.ADMIN || session.user.role === Role.OPS_MANAGER;

  return (
    <PortalShell
      companyName={settings.companyName || "sNeek Property Services"}
      logoUrl={settings.logoUrl}
      portalLabel="QA Portal"
      portalTitle="Inspections and quality checks"
      settingsHref="/qa/profile"
      currentUserName={session.user.name}
      currentUserImage={session.user.image}
      portalTheme={settings.portalTheme}
      navItems={[
        { href: "/qa", label: "Queue", exact: true },
        { href: "/qa/profile", label: "Profile" },
        ...(canOpenAdmin ? [{ href: "/admin", label: "Admin" }] : []),
      ]}
    >
      {children}
    </PortalShell>
  );
}
