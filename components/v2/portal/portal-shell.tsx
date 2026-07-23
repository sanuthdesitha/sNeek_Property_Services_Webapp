"use client";

/**
 * ESTATE v2 portal shell — the deep-green rail + warm-ivory canvas silhouette,
 * with a mobile drawer + bottom tab bar. Accent comes from the data-portal-accent
 * set by each portal layout. Presentation only; nav config passed in.
 */
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { LookSwitchLink } from "@/components/look-switch-link";
import { LogOut, Menu, X } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

export function PortalShell({
  accent,
  wordmark,
  nav,
  user,
  roleLabel,
  children,
}: {
  accent: "admin" | "client" | "cleaner" | "laundry" | "qa" | "maintenance";
  wordmark: string;
  nav: NavItem[];
  /** Optional override; when omitted the signed-in NextAuth session user is shown. */
  user?: { name: string; role: string };
  /** Second line under the user's name, e.g. "Admin", "Client". */
  roleLabel?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const displayName = user?.name ?? session?.user?.name ?? "";
  const displayRole = user?.role ?? roleLabel ?? "";
  const initials = displayName.trim().slice(0, 2).toUpperCase();
  const [open, setOpen] = React.useState(false);
  // Deepest-match active nav: only the LONGEST href that prefixes the current
  // path is highlighted, so "Quality" doesn't stay lit on /quality/issues etc.
  const bestMatchHref = React.useMemo(() => {
    let best = "";
    for (const item of nav) {
      const matches =
        pathname === item.href ||
        (item.href !== "/v2/" + accent && pathname.startsWith(item.href + "/")) ||
        (item.href !== "/v2/" + accent && pathname.startsWith(item.href) &&
          (pathname.length === item.href.length || pathname[item.href.length] === "?"));
      if (matches && item.href.length > best.length) best = item.href;
    }
    return best;
  }, [nav, pathname, accent]);
  const isActive = (href: string) => href === bestMatchHref;

  const railInner = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2 px-5">
        <span className="e-serif text-[1.25rem] font-[520] text-[hsl(var(--e-sidebar-fg))]">{wordmark}</span>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {nav.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                "group flex items-center gap-3 rounded-[var(--e-radius-sm)] px-3 py-2 text-[0.8125rem] font-medium transition-colors duration-150",
                active
                  ? "bg-[hsl(var(--e-sidebar-active-bg))] text-[hsl(var(--e-sidebar-active-fg))]"
                  : "text-[hsl(var(--e-sidebar-fg))] hover:bg-white/5"
              )}
            >
              {active ? <span className="absolute left-0 h-5 w-0.5 rounded-r bg-[hsl(var(--e-gold))]" /> : null}
              <Icon className="h-[1.05rem] w-[1.05rem] flex-shrink-0" />
              <span className="flex-1 truncate">{item.label}</span>
              {item.badge ? (
                <span className="rounded-full bg-[hsl(var(--e-gold))] px-1.5 text-[0.625rem] font-semibold text-[hsl(var(--e-gold-foreground))]">
                  {item.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-[hsl(var(--e-sidebar-hairline))] px-4 py-3">
        {/* Personal escape hatch to the classic app, independent of the house
            default set in Settings → Default look. */}
        <div className="mb-2">
          <LookSwitchLink />
        </div>
        <div className="flex items-center gap-3">
          <span
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[0.75rem] font-semibold text-[hsl(var(--e-sidebar-active-fg))] ring-2"
            style={{ backgroundColor: "hsl(var(--e-sidebar-active-bg))", ["--tw-ring-color" as any]: "hsl(var(--e-accent-portal))" }}
          >
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.8125rem] font-medium text-[hsl(var(--e-sidebar-fg))]">{displayName}</p>
            <p className="truncate text-[0.6875rem] text-[hsl(var(--e-sidebar-fg))]/60">{displayRole}</p>
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/v2/login" })}
            aria-label="Sign out"
            title="Sign out"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[var(--e-radius-sm)] text-[hsl(var(--e-sidebar-fg))]/60 transition-colors duration-150 hover:bg-white/5 hover:text-[hsl(var(--e-sidebar-fg))]"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[hsl(var(--e-background))]">
      {/* Desktop rail — truly fixed so it never scrolls with the page */}
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-60 flex-shrink-0 border-r border-[hsl(var(--e-border))] bg-[hsl(var(--e-sidebar-bg))] lg:flex lg:flex-col">
        {railInner}
      </aside>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-[hsl(var(--e-sidebar-bg))]">
            <button className="absolute right-3 top-4 text-[hsl(var(--e-sidebar-fg))]" onClick={() => setOpen(false)}>
              <X className="h-5 w-5" />
            </button>
            {railInner}
          </aside>
        </div>
      ) : null}

      {/* Main column — offset by the fixed rail width on desktop */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface)/0.85)] px-4 backdrop-blur lg:px-8">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Menu">
            <Menu className="h-5 w-5 text-[hsl(var(--e-foreground))]" />
          </button>
          <span className="e-serif text-[1.05rem] font-[520] lg:hidden">{wordmark}</span>
        </header>

        <main className="flex-1 px-4 pb-24 pt-6 lg:px-8 lg:pb-10">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>

        {/* Mobile bottom tabs (first 5) */}
        <nav className="fixed bottom-0 left-0 right-0 z-30 flex border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface)/0.95)] backdrop-blur lg:hidden">
          {nav.slice(0, 5).map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.625rem] font-medium",
                  active ? "text-[hsl(var(--e-accent-portal))]" : "text-[hsl(var(--e-muted-foreground))]"
                )}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
