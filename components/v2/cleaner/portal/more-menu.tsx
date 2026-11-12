"use client";

/**
 * The More tab (board: "More menu (☰ tab, full-height sheet) · Role filtered").
 *
 * Every destination that is not one of the four daily tabs, grouped Work / You,
 * each a 44px link with the board's description. Role filtering: module gates
 * come from the server page (`modules`), the maintenance entry from the live
 * assignment check. The account block carries what the drawer used to hold:
 * switch role, classic look and sign out (notifications stay in the header).
 */
import * as React from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { ChevronRight, LogOut } from "lucide-react";
import { RoleSwitcher } from "@/components/v2/portal/role-switcher";
import { LookSwitchLink } from "@/components/look-switch-link";
import { useMaintenanceSection } from "@/components/v2/portal/use-maintenance-section";
import {
  CLEANER_MORE_SECTIONS,
  moreItemVisible,
  type CleanerNavModule,
} from "@/components/v2/cleaner/portal/portal-nav";

export interface CleanerMoreMenuProps {
  /** Module visibility from the server; a missing key means "not gated". */
  modules: Partial<Record<CleanerNavModule, boolean>>;
}

export function CleanerMoreMenu({ modules }: CleanerMoreMenuProps) {
  const maintenance = useMaintenanceSection();

  return (
    <div className="space-y-6">
      {CLEANER_MORE_SECTIONS.map((section) => {
        const items = section.items.filter((item) => moreItemVisible(item, modules, maintenance.assigned));
        if (items.length === 0) return null;
        const headingId = `more-${section.title.toLowerCase()}`;
        return (
          <section key={section.title} aria-labelledby={headingId} className="space-y-2">
            <h2 id={headingId} className="e-eyebrow">{section.title}</h2>
            <ul className="divide-y divide-[hsl(var(--e-border))] overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
              {items.map((item) => {
                const Icon = item.icon;
                const badge = item.requiresMaintenanceAssignment ? maintenance.count : 0;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="flex min-h-12 items-center gap-3 px-4 py-2.5 hover:bg-[hsl(var(--e-muted))] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2"
                    >
                      <Icon className="h-[1.1rem] w-[1.1rem] shrink-0 text-[hsl(var(--e-accent-portal))]" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.9375rem] font-[550]">{item.label}</span>
                        {item.detail ? (
                          <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{item.detail}</span>
                        ) : null}
                      </span>
                      {badge > 0 ? (
                        <span className="rounded-full bg-[hsl(var(--e-danger))] px-1.5 text-[0.6875rem] font-semibold text-white">
                          <span className="sr-only">Open items: </span>{badge > 9 ? "9+" : badge}
                        </span>
                      ) : null}
                      <ChevronRight className="h-4 w-4 shrink-0 text-[hsl(var(--e-muted-foreground))]" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <section aria-labelledby="more-account" className="space-y-2">
        <h2 id="more-account" className="e-eyebrow">Account</h2>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Notifications are in the bell at the top of the screen.
        </p>
        {/* The switcher and look link are drawn for the dark rail; they keep it here. */}
        <div className="space-y-2 rounded-[var(--e-radius-lg)] bg-[hsl(var(--e-sidebar-bg))] p-4">
          <RoleSwitcher />
          <LookSwitchLink />
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/v2/login" })}
            className="flex min-h-11 items-center gap-2 rounded-[var(--e-radius-sm)] px-1 text-[0.875rem] font-[550] text-[hsl(var(--e-sidebar-fg))] hover:bg-white/5 focus-visible:outline focus-visible:outline-2"
          >
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        </div>
      </section>
    </div>
  );
}
