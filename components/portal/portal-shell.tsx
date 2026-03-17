"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LogOut, Settings2 } from "lucide-react";

type PortalNavItem = {
  href: string;
  label: string;
  exact?: boolean;
};

interface PortalShellProps {
  children: React.ReactNode;
  companyName: string;
  logoUrl?: string | null;
  portalLabel: string;
  portalTitle: string;
  navItems: PortalNavItem[];
  settingsHref: string;
  maxWidthClass?: string;
}

function initialsFromName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function PortalShell({
  children,
  companyName,
  logoUrl,
  portalLabel,
  portalTitle,
  navItems,
  settingsHref,
  maxWidthClass = "max-w-6xl",
}: PortalShellProps) {
  const pathname = usePathname();
  const initials = initialsFromName(companyName) || "SP";

  function handleSignOut() {
    if (typeof window === "undefined") return;
    const callbackUrl = `${window.location.origin}/login`;
    window.location.assign(`/api/auth/local-signout?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  return (
    <div className="relative min-h-screen bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_96%_0%,rgba(39,153,163,0.18),transparent_24%),radial-gradient(circle_at_4%_16%,rgba(255,174,87,0.16),transparent_28%)]" />

      <header className="sticky top-0 z-40 border-b border-white/60 bg-white/80 px-3 py-3 shadow-sm backdrop-blur-xl sm:px-4 lg:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={`${companyName} logo`}
                  className="h-10 w-10 rounded-2xl bg-white p-0.5 object-cover shadow-sm"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary shadow-sm">
                  <span className="text-xs font-bold text-white">{initials}</span>
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {portalLabel}
                </p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate text-sm font-semibold sm:text-base">{companyName}</span>
                  <span className="hidden text-muted-foreground sm:inline">/</span>
                  <span className="truncate text-sm text-muted-foreground">{portalTitle}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                asChild
                className="rounded-full bg-white/80 text-muted-foreground hover:text-foreground"
              >
                <Link href={settingsHref}>
                  <Settings2 className="mr-1.5 h-4 w-4" />
                  Settings
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-full bg-white/80 text-muted-foreground hover:text-foreground"
                onClick={handleSignOut}
              >
                <>
                  <LogOut className="mr-1.5 h-4 w-4" />
                  Sign out
                </>
              </Button>
            </div>
          </div>

          <nav className="-mx-1 overflow-x-auto pb-1">
            <div className="flex w-max min-w-full gap-2 px-1">
              {navItems.map((item) => {
                const active = item.exact
                  ? pathname === item.href
                  : pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "rounded-full px-3 py-2 text-xs font-medium transition-all sm:text-sm",
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "border border-border/70 bg-white/75 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      </header>

      <main className={cn("page-fade relative z-10 mx-auto w-full px-3 py-4 pb-20 sm:px-4 lg:px-6", maxWidthClass)}>
        {children}
      </main>
    </div>
  );
}
