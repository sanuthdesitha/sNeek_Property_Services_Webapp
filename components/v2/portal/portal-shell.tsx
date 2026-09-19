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
import { RoleSwitcher } from "@/components/v2/portal/role-switcher";
import { NotificationInbox } from "@/components/v2/portal/notification-inbox";
import { PortalSearch } from "@/components/v2/portal/portal-search";
import { ChevronDown, LogOut, Menu, Search, Star, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { mobileTabs } from "@/lib/navigation/mobile-tabs";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  /**
   * Optional collapsible section in the desktop rail and mobile drawer.
   * Ungrouped entries always remain visible outside search filtering.
   */
  group?: string;
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
  const [query, setQuery] = React.useState("");
  const preferenceKey = session?.user?.id ? `sneek:nav-favorites:${session.user.id}:${accent}` : null;
  const [preferences, setPreferences] = React.useState<{ key: string | null; hrefs: string[] }>({ key: null, hrefs: [] });
  const favorites = preferences.key === preferenceKey ? preferences.hrefs : [];
  const groupPreferenceKey = session?.user?.id ? `sneek:nav-groups:${session.user.id}:${accent}` : null;
  const [groupPreferences, setGroupPreferences] = React.useState<{ key: string | null; collapsed: string[] }>({ key: null, collapsed: [] });
  const collapsedGroups = groupPreferences.key === groupPreferenceKey ? groupPreferences.collapsed : [];
  const [dismissedActiveGroup, setDismissedActiveGroup] = React.useState<string | null>(null);
  const navigationId = React.useId();
  React.useEffect(() => {
    let collapsed: string[] = [];
    try {
      const stored: unknown = groupPreferenceKey ? JSON.parse(localStorage.getItem(groupPreferenceKey) || "[]") : [];
      if (Array.isArray(stored)) collapsed = Array.from(new Set(stored.filter((group): group is string => typeof group === "string"))).slice(0, 100);
    } catch { /* Navigation remains usable when browser storage is unavailable. */ }
    setGroupPreferences({ key: groupPreferenceKey, collapsed });
  }, [groupPreferenceKey]);
  React.useEffect(() => {
    setDismissedActiveGroup(null);
  }, [groupPreferenceKey, pathname]);
  React.useEffect(() => {
    let hrefs: string[] = [];
    try {
      const stored: unknown = preferenceKey ? JSON.parse(localStorage.getItem(preferenceKey) || "[]") : [];
      if (Array.isArray(stored)) hrefs = stored.filter((href): href is string => typeof href === "string").slice(0, 100);
    } catch { /* Navigation remains usable when browser storage is unavailable. */ }
    setPreferences({ key: preferenceKey, hrefs });
  }, [preferenceKey]);
  const toggleFavorite = (href: string) => {
    if (!preferenceKey) return;
    const hrefs = favorites.includes(href) ? favorites.filter((item) => item !== href) : [...favorites, href];
    setPreferences({ key: preferenceKey, hrefs });
    try { localStorage.setItem(preferenceKey, JSON.stringify(hrefs)); } catch { /* Keep the session preference. */ }
  };
  const menuRef = React.useRef<HTMLButtonElement>(null);
  // Saved preferences may reorder allowed entries, but never supply destinations.
  const orderedNav = [
    ...nav.filter((item) => favorites.includes(item.href)).map((item) => ({ ...item, group: "Favorites" })),
    ...nav.filter((item) => !favorites.includes(item.href)),
  ];
  const filteredNav = orderedNav.filter((item) =>
    `${item.label} ${item.group ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())
  );
  const sections: { group?: string; items: NavItem[] }[] = [];
  for (const item of filteredNav) {
    const previous = sections[sections.length - 1];
    if (previous && previous.group === item.group) previous.items.push(item);
    else sections.push({ group: item.group, items: [item] });
  }
  const tabs = mobileTabs(accent, nav);

  React.useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
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
  const activeGroup = orderedNav.find((item) => isActive(item.href))?.group;
  const activeGroupToken = JSON.stringify([groupPreferenceKey, pathname, activeGroup]);
  const searching = query.trim().length > 0;
  const groupExpanded = (group: string) => searching || !collapsedGroups.includes(group) ||
    (group === activeGroup && dismissedActiveGroup !== activeGroupToken);
  const toggleGroup = (group: string) => {
    if (searching) return;
    const expanded = groupExpanded(group);
    const collapsed = expanded ? Array.from(new Set([...collapsedGroups, group])) : collapsedGroups.filter((entry) => entry !== group);
    if (group === activeGroup) setDismissedActiveGroup(activeGroupToken);
    setGroupPreferences({ key: groupPreferenceKey, collapsed });
    if (groupPreferenceKey) {
      try { localStorage.setItem(groupPreferenceKey, JSON.stringify(collapsed)); } catch { /* Keep the session preference. */ }
    }
  };
  const showAllPages = () => {
    setQuery("");
    setDismissedActiveGroup(null);
    setGroupPreferences({ key: groupPreferenceKey, collapsed: [] });
    if (groupPreferenceKey) {
      try { localStorage.setItem(groupPreferenceKey, "[]"); } catch { /* The full navigation remains available in this session. */ }
    }
  };

  const railInner = (surface: "desktop" | "drawer") => (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-16 items-center gap-2 px-5">
        <span className="e-serif text-[1.25rem] font-[520] text-[hsl(var(--e-sidebar-fg))]">{wordmark}</span>
      </div>
      <div className="relative mx-3 mb-2">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-[hsl(var(--e-sidebar-fg))]" />
        <input type="search" aria-label="Search navigation" placeholder="Search navigation" value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-11 w-full rounded border border-[hsl(var(--e-sidebar-hairline))] bg-transparent pl-9 pr-2 text-sm text-[hsl(var(--e-sidebar-fg))] placeholder:text-[hsl(var(--e-sidebar-fg))]/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" />
      </div>
      <button type="button" onClick={showAllPages}
        className="mx-3 min-h-11 rounded px-3 text-left text-xs text-[hsl(var(--e-sidebar-fg))] hover:bg-white/5 focus-visible:outline focus-visible:outline-2">
        Show all pages
      </button>
      <nav aria-label="Portal navigation" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-3 py-2">
        {filteredNav.length === 0 ? <p role="status" className="px-3 py-4 text-sm text-[hsl(var(--e-sidebar-fg))]">No matching pages</p> : null}
        {sections.map((section, index) => {
          const expanded = !section.group || groupExpanded(section.group);
          const sectionId = `${navigationId}-${surface}-group-${index}`;
          return <React.Fragment key={`${section.group ?? "ungrouped"}-${index}`}>
            {section.group ? <button type="button" aria-expanded={expanded} aria-controls={sectionId}
              aria-disabled={searching || undefined}
              onClick={() => toggleGroup(section.group!)}
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded px-3 py-2 text-left text-[0.625rem] font-semibold uppercase text-[hsl(var(--e-sidebar-fg))] hover:bg-white/5 focus-visible:outline focus-visible:outline-2">
              <span>{section.group}</span>
              <ChevronDown aria-hidden="true" className={cn("h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none", !expanded && "-rotate-90")} />
            </button> : null}
            <div id={sectionId} hidden={!expanded} className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item.href);
                const Icon = item.icon;
                return (
                  <div key={item.href} className="flex items-center gap-0.5">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    title={item.label}
                    onClick={() => { setOpen(false); setQuery(""); }}
                    className={cn(
                      "group relative flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-[var(--e-radius-sm)] px-3 py-2 text-[0.8125rem] font-medium transition-colors duration-150 lg:min-h-0",
                      active
                        ? "bg-[hsl(var(--e-sidebar-active-bg))] text-[hsl(var(--e-sidebar-active-fg))]"
                        : "text-[hsl(var(--e-sidebar-fg))] hover:bg-white/5"
                    )}
                  >
                    {active ? <span className="absolute left-0 h-5 w-0.5 rounded-r bg-[hsl(var(--e-gold))]" /> : null}
                    <Icon className="h-[1.05rem] w-[1.05rem] flex-shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {/* Red, not gold: this is "something needs you", and gold is the
                        brand accent used decoratively everywhere else. */}
                    {item.badge ? (
                      <span className="rounded-full bg-[hsl(var(--e-danger))] px-1.5 text-[0.625rem] font-semibold text-white">
                        {item.badge > 9 ? "9+" : item.badge}
                      </span>
                    ) : null}
                  </Link>
                  {preferenceKey ? <button type="button"
                    aria-label={`${favorites.includes(item.href) ? "Unpin" : "Pin"} ${item.label}`}
                    title={`${favorites.includes(item.href) ? "Unpin" : "Pin"} ${item.label}`}
                    aria-pressed={favorites.includes(item.href)}
                    onClick={() => toggleFavorite(item.href)}
                    className="flex h-11 w-8 shrink-0 items-center justify-center rounded text-[hsl(var(--e-sidebar-fg))] hover:bg-white/10 focus-visible:outline focus-visible:outline-2 lg:h-8">
                    <Star aria-hidden="true" className={cn("h-3.5 w-3.5", favorites.includes(item.href) && "fill-current")} />
                  </button> : null}
                  </div>
                );
            })}
            </div>
          </React.Fragment>;
        })}
      </nav>
      <div className="border-t border-[hsl(var(--e-sidebar-hairline))] px-4 py-3">
        {/* Which of their jobs they are currently doing. Renders nothing at all
            for the overwhelming majority of accounts, which hold one role — it
            sits above the look switch because changing PORTAL is a bigger move
            than changing skin, and next to the identity it belongs to. */}
        <RoleSwitcher />
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
        {railInner("desktop")}
      </aside>

      {/* Mobile drawer */}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content data-skin="estate" data-portal-accent={accent}
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => { event.preventDefault(); menuRef.current?.focus(); }}
            className="e-nav-drawer fixed left-0 top-0 z-50 h-[100dvh] w-72 max-w-[calc(100vw-2rem)] bg-[hsl(var(--e-sidebar-bg))] shadow-xl">
            <Dialog.Title className="sr-only">{roleLabel || "Portal"} navigation</Dialog.Title>
            <Dialog.Close aria-label="Close navigation" className="absolute right-2 top-2.5 flex h-11 w-11 items-center justify-center text-[hsl(var(--e-sidebar-fg))]">
              <X aria-hidden="true" className="h-5 w-5" />
            </Dialog.Close>
            {railInner("drawer")}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Main column — offset by the fixed rail width on desktop */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface)/0.85)] px-4 backdrop-blur lg:px-8">
          <button ref={menuRef} className="flex h-11 w-11 shrink-0 items-center justify-center lg:hidden" onClick={() => setOpen(true)} aria-label="Menu" aria-expanded={open} aria-haspopup="dialog">
            <Menu className="h-5 w-5 text-[hsl(var(--e-foreground))]" />
          </button>
          <span className="e-serif min-w-0 truncate text-[1.05rem] font-[520] lg:hidden">{wordmark}</span>
          <p className="hidden min-w-0 truncate text-sm text-[hsl(var(--e-muted-foreground))] lg:block">
            {roleLabel || accent} / <span className="font-medium text-[hsl(var(--e-foreground))]">{nav.find((item) => item.href === bestMatchHref)?.label || "Details"}</span>
          </p>
          <div className="ml-auto flex items-center gap-1">
            <PortalSearch accent={accent} nav={nav} />
            <NotificationInbox accent={accent} />
          </div>
        </header>

        <main className="flex-1 px-4 pb-24 pt-6 lg:px-8 lg:pb-10">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>

        {/* Stable daily destinations, independent of sidebar order and favorites. */}
        <nav className="fixed bottom-0 left-0 right-0 z-30 flex border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface)/0.95)] backdrop-blur lg:hidden">
          {tabs.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.625rem] font-medium",
                  active ? "text-[hsl(var(--e-accent-portal))]" : "text-[hsl(var(--e-muted-foreground))]"
                )}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" />
                  {item.badge ? (
                    <span className="absolute -right-2 -top-1 min-w-[1rem] rounded-full bg-[hsl(var(--e-danger))] px-1 text-[0.5625rem] font-semibold leading-4 text-white">
                      {item.badge > 9 ? "9+" : item.badge}
                    </span>
                  ) : null}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
