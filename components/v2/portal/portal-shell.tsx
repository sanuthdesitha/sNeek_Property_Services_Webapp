"use client";

/**
 * ESTATE v2 portal shell — the deep-green rail + warm-ivory canvas silhouette,
 * with a mobile drawer + bottom tab bar. Accent comes from the data-portal-accent
 * set by each portal layout. Presentation only; nav config passed in.
 */
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Menu, X } from "lucide-react";

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
  children,
}: {
  accent: "admin" | "client" | "cleaner" | "laundry" | "qa" | "maintenance";
  wordmark: string;
  nav: NavItem[];
  user?: { name: string; role: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const isActive = (href: string) => pathname === href || (href !== "/v2/" + accent && pathname.startsWith(href));

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
      {user ? (
        <div className="border-t border-[hsl(var(--e-sidebar-hairline))] px-4 py-3">
          <div className="flex items-center gap-3">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full text-[0.75rem] font-semibold text-[hsl(var(--e-sidebar-active-fg))] ring-2"
              style={{ backgroundColor: "hsl(var(--e-sidebar-active-bg))", ["--tw-ring-color" as any]: "hsl(var(--e-accent-portal))" }}
            >
              {user.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[0.8125rem] font-medium text-[hsl(var(--e-sidebar-fg))]">{user.name}</p>
              <p className="truncate text-[0.6875rem] text-[hsl(var(--e-sidebar-fg))]/60">{user.role}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[hsl(var(--e-background))]">
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-screen w-60 flex-shrink-0 bg-[hsl(var(--e-sidebar-bg))] lg:block">
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

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
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
