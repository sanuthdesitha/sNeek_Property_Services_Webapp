import { AdminSidebar } from "@/components/admin/sidebar";
import { AdminHeader } from "@/components/admin/header";
import { getAppSettings } from "@/lib/settings";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { DensityShell } from "@/app/_density-shell";
import { ThemeProvider } from "@/lib/theme/context";
import { getThemeForUser } from "@/lib/theme/server";
import { CommandPalette } from "@/components/command-palette";
import { ShortcutCheatsheet } from "@/components/shortcuts/cheatsheet";
import { GlobalShortcutListener } from "@/hooks/use-keyboard-shortcuts";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings();
  const themePref = await getThemeForUser(session.user.id);

  // For SSR, treat "system" as the same default as the root layout (light).
  // The pre-hydration script in app/layout.tsx will swap to dark if the OS
  // prefers dark; the ThemeProvider's effect picks it up after hydration.
  const ssrTheme = themePref === "dark" ? "dark" : "light";

  return (
    <DensityShell>
      <ThemeProvider initial={themePref}>
        <GlobalShortcutListener />
        <div
          data-portal-theme={ssrTheme}
          className="relative flex h-screen overflow-hidden bg-background"
        >
          <AdminSidebar
            companyName={settings.companyName}
            logoUrl={settings.logoUrl}
            userName={session.user.name}
            userImage={session.user.image}
            className="hidden md:flex"
          />
          <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
            <AdminHeader companyName={settings.companyName} logoUrl={settings.logoUrl} />
            <main className="page-fade flex-1 overflow-y-auto px-3 py-4 sm:px-4 md:px-6 md:py-6">
              {/* Single shared content column so every admin page lines up at the
                  same left/right edges and stays centered + capped on wide
                  screens — fixes content shifting between pages. */}
              <div className="mx-auto w-full max-w-screen-2xl">{children}</div>
            </main>
          </div>
        </div>
        <CommandPalette />
        <ShortcutCheatsheet />
      </ThemeProvider>
    </DensityShell>
  );
}
