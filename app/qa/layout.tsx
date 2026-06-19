import type { Metadata } from "next";
import Link from "next/link";
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

  // Admins live in the admin console, so when they hop into the QA view show a
  // clear "you are in QA" notice with a one-tap exit. QA inspectors (for whom
  // this IS home) never see it.
  const isAdminViewer = session.user.role === Role.ADMIN;

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
      {isAdminViewer ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
          <span className="font-medium">You&apos;re in the QA view.</span>
          <Link
            href="/admin"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-400/70 bg-white/70 px-2.5 py-1 font-semibold text-amber-900 transition hover:bg-white dark:bg-amber-900/30 dark:text-amber-100 dark:hover:bg-amber-900/50"
          >
            Exit QA view →
          </Link>
        </div>
      ) : null}
      {children}
    </PortalShell>
  );
}
