"use client";

/**
 * The labelled More menu shared by the QA and maintenance portals (boards
 * "QA portal" and "Maintenance portal", 2026-11). Each entry is a 48px link
 * with the board's description; sections are already filtered for the viewer
 * by the caller. The account block carries what the phone drawer used to hold:
 * switch role, classic look and sign out (notifications stay in the header).
 */
import * as React from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { ChevronRight, LogOut } from "lucide-react";
import { RoleSwitcher } from "@/components/v2/portal/role-switcher";
import { LookSwitchLink } from "@/components/look-switch-link";
import type { PortalMoreSection } from "@/lib/navigation/portal-more";

export interface MoreMenuListProps {
  sections: readonly PortalMoreSection[];
  /** Real counts by href (maintenance while assigned); zero shows nothing. */
  badges?: Readonly<Record<string, number>>;
  /** One sentence under a section heading, keyed by section title. */
  notes?: Readonly<Record<string, string>>;
}

function sectionId(title: string): string {
  return `more-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function MoreMenuList({ sections, badges = {}, notes = {} }: MoreMenuListProps) {
  return (
    <div className="space-y-6">
      {sections.map((section) => {
        const headingId = sectionId(section.title);
        return (
          <section key={section.title} aria-labelledby={headingId} className="space-y-2">
            <h2 id={headingId} className="e-eyebrow">{section.title}</h2>
            {notes[section.title] ? (
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{notes[section.title]}</p>
            ) : null}
            <ul className="divide-y divide-[hsl(var(--e-border))] overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
              {section.items.map((item) => {
                const Icon = item.icon;
                const badge = badges[item.href] ?? 0;
                return (
                  <li key={`${item.href}-${item.label}`}>
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
