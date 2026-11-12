"use client";

/**
 * The phone "More" tab and its sheet (board "Admin phone", 2026-11). Below
 * 640px it replaces the navigation drawer for portals configured in
 * `lib/navigation/mobile-tabs.ts` (the admin portal): every authorized rail
 * entry that is not a tab, grouped exactly like the rail, with the rail's
 * attention badges and a "Find a page" filter.
 *
 * It receives the rail's own entries after the shell's role, permission-pack
 * and admin-only filtering, so it can never offer a page the rail would hide.
 * The tab shows a dot (not a sum: the badges count different things) when any
 * entry inside has a badge, and is lit when the current page lives in it.
 */
import * as React from "react";
import Link from "next/link";
import { Menu, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { EBottomSheet } from "@/components/v2/ui/bottom-sheet";
import { phoneMoreSections } from "@/lib/navigation/mobile-tabs";
import type { NavItem } from "./portal-shell";

export type PhoneMoreTabProps = {
  /** The phone tabs shown before More. */
  tabs: NavItem[];
  /** The rail's entries (already filtered by role, packs and adminOnly). */
  nav: NavItem[];
  isActive: (href: string) => boolean;
  /** Names the sheet, e.g. "Admin". */
  roleLabel?: string;
};

function badgeText(badge: number): string {
  return badge > 9 ? "9+" : String(badge);
}

export function PhoneMoreTab({ tabs, nav, isActive, roleLabel }: PhoneMoreTabProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const allSections = phoneMoreSections(tabs, nav);
  const sections = phoneMoreSections(tabs, nav, query);
  const inside = allSections.flatMap((section) => section.items);
  const needsAttention = inside.some((item) => (item.badge ?? 0) > 0);
  const current = inside.some((item) => isActive(item.href));
  const searchId = React.useId();

  // The sheet is a phone control: close it when the viewport grows past 640px.
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const wide = window.matchMedia("(min-width: 640px)");
    const closeWhenWide = () => { if (wide.matches) setOpen(false); };
    wide.addEventListener?.("change", closeWhenWide);
    return () => wide.removeEventListener?.("change", closeWhenWide);
  }, []);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setQuery("");
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={cn(
          "flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[0.625rem] font-medium",
          current ? "text-[hsl(var(--e-accent-portal))]" : "text-[hsl(var(--e-muted-foreground))]",
        )}
      >
        <span className="relative">
          <Menu aria-hidden className="h-5 w-5" />
          {needsAttention ? <span aria-hidden className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-[hsl(var(--e-danger))]" /> : null}
        </span>
        More
        {needsAttention ? <span className="sr-only">, some pages need attention</span> : null}
      </button>
      <EBottomSheet open={open} onOpenChange={onOpenChange} title="More" description={roleLabel ? `${roleLabel} pages` : undefined} tall>
        <div className="space-y-4">
          <div className="relative">
            <label htmlFor={searchId} className="sr-only">Find a page</label>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-muted-foreground))]" />
            <input
              id={searchId}
              type="search"
              placeholder="Find a page"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-11 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] pl-9 pr-3 text-[1rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
            />
          </div>
          {sections.length === 0 ? <p role="status" className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No matching pages</p> : null}
          <nav aria-label="More pages" className="space-y-4">
            {sections.map((section) => (
              <section key={section.group} aria-label={section.group}>
                <h3 className="e-eyebrow mb-1.5">{section.group}</h3>
                <ul className="grid grid-cols-2 gap-1.5">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.href);
                    return (
                      <li key={item.href} className="min-w-0">
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          onClick={() => onOpenChange(false)}
                          className={cn(
                            "flex min-h-11 min-w-0 items-center gap-2 rounded-[10px] border px-2.5 text-[0.8125rem] font-[500] no-underline",
                            active
                              ? "border-[hsl(var(--e-primary)/0.35)] bg-[hsl(var(--e-primary-soft))] text-[hsl(var(--e-primary))]"
                              : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))]",
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0 text-[hsl(var(--e-text-secondary))]" />
                          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{item.label}</span>
                          {item.badge ? (
                            <span className="shrink-0 rounded-full bg-[hsl(var(--e-danger))] px-1.5 text-[0.625rem] font-semibold text-white">
                              {badgeText(item.badge)}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </nav>
        </div>
      </EBottomSheet>
    </>
  );
}
