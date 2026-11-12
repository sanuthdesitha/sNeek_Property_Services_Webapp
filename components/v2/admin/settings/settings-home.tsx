"use client";

/**
 * Settings home (owner board "Settings", 2026-11): every category of the
 * shared settings catalog with all its destinations at once (role-filtered on
 * the server exactly as the category navigation is), a search over names and
 * descriptions that also finds settings kept on other pages, state badges only
 * where the server read a real fact, "Admin" marks for administrators, needs
 * attention and recent changes.
 */
import * as React from "react";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { EPill } from "@/components/v2/ui/pill";
import { matchesSettingsQuery, SETTINGS_ELSEWHERE, type SettingsDestinationState, type SettingsRecentChange } from "@/lib/admin/settings-home-types";

export type HomeDestination = { key: string; label: string; description: string; group: string; adminOnly: boolean; href: string };
export type HomeGroup = { key: string; label: string; description: string };

type SettingsHomeProps = {
  groups: HomeGroup[];
  destinations: HomeDestination[];
  isAdmin: boolean;
  states: Record<string, SettingsDestinationState>;
  recent: SettingsRecentChange[] | null;
  auditHref: string | null;
  timezone: string;
};

function DestinationLink({ item, state, isAdmin }: { item: HomeDestination; state?: SettingsDestinationState; isAdmin: boolean }) {
  return (
    <Link
      href={item.href}
      className="flex min-h-[44px] items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 text-[0.8125rem] hover:bg-[hsl(var(--e-muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
    >
      <span className="min-w-0 [overflow-wrap:anywhere]">{item.label}</span>
      <span className="flex shrink-0 items-center gap-1">
        {state ? <EPill tone={state.tone}>{state.text}</EPill> : null}
        {isAdmin && item.adminOnly ? <EPill>Admin</EPill> : null}
      </span>
    </Link>
  );
}

export function SettingsHome({ groups, destinations, isAdmin, states, recent, auditHref, timezone }: SettingsHomeProps) {
  const [query, setQuery] = React.useState("");
  const trimmed = query.trim();
  const groupLabel = (key: string) => groups.find((group) => group.key === key)?.label ?? key;
  const results = trimmed
    ? [
        ...destinations.filter((item) => matchesSettingsQuery(trimmed, item.label, item.description, groupLabel(item.group))).map((item) => ({ key: item.key, label: item.label, place: groupLabel(item.group), description: item.description, href: item.href, mark: isAdmin && item.adminOnly ? "Admin" : undefined })),
        ...SETTINGS_ELSEWHERE.filter((item) => matchesSettingsQuery(trimmed, item.label, item.description, item.place)).map((item) => ({ ...item })),
      ]
    : [];
  const attention = destinations.filter((item) => states[item.key]);

  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="settings-home-search" className="text-[0.75rem] font-[550]">Search settings</label>
          <input
            id="settings-home-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Any word in a setting's name or description"
            className="h-11 w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[16px] sm:max-w-md sm:text-[0.875rem]"
          />
        </div>
        {trimmed ? (
          <section aria-label="Search results" className="rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
            <p className="e-eyebrow mb-2" aria-live="polite">{results.length} match{results.length === 1 ? "" : "es"} for “{trimmed}”</p>
            {results.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No setting matches. Try another word.</p> : null}
            <ul className="divide-y divide-[hsl(var(--e-border))]">
              {results.map((item) => (
                <li key={`${item.place}:${item.key}`}>
                  <Link href={item.href} className="flex min-h-[44px] items-center justify-between gap-3 py-2 hover:underline">
                    <span className="min-w-0">
                      <span className="block text-[0.875rem] font-[600]">{item.label}</span>
                      <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{item.place} · {item.description}</span>
                    </span>
                    {item.mark ? <EPill>{item.mark}</EPill> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((group) => {
            const items = destinations.filter((item) => item.group === group.key);
            if (items.length === 0) return null;
            return (
              <section key={group.key} aria-labelledby={`settings-group-${group.key}`} className="rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4">
                <h2 id={`settings-group-${group.key}`} className="text-[0.9375rem] font-[650]">{group.label}</h2>
                <p className="mb-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{group.description}</p>
                <div className="flex flex-col">
                  {items.map((item) => <DestinationLink key={item.key} item={item} state={states[item.key]} isAdmin={isAdmin} />)}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      <aside aria-label="Settings status" className="min-w-0 space-y-4">
        <section aria-labelledby="settings-attention" className="rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4">
          <h2 id="settings-attention" className="text-[0.9375rem] font-[650]">Needs attention</h2>
          {attention.length === 0 ? (
            <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Nothing recorded needs attention. Connections without a stored status are not shown here.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {attention.map((item) => (
                <li key={item.key} className="flex items-start justify-between gap-2 text-[0.8125rem]">
                  <span className="min-w-0"><span className="block font-[600]">{item.label}</span><span className="text-[hsl(var(--e-muted-foreground))]">{states[item.key].detail}</span></span>
                  <Link href={item.href} className="shrink-0 text-[hsl(var(--e-primary))] hover:underline">Open</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        {recent !== null && isAdmin ? (
          <section aria-labelledby="settings-recent" className="rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 id="settings-recent" className="text-[0.9375rem] font-[650]">Recently changed</h2>
              {auditHref ? <Link href={auditHref} className="text-[0.8125rem] text-[hsl(var(--e-primary))] hover:underline">All</Link> : null}
            </div>
            {recent.length === 0 ? <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No recorded changes yet.</p> : (
              <ul className="mt-2 space-y-1.5 text-[0.8125rem]">
                {recent.map((row) => (
                  <li key={row.id}>{row.action.replace(/_/g, " ").toLowerCase()} <span className="text-[hsl(var(--e-muted-foreground))]">· {row.by} · {formatInTimeZone(new Date(row.at), timezone, "d MMM")}</span></li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
        <section aria-labelledby="settings-what" className="rounded-[12px] border border-[hsl(var(--e-border))] p-4 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          <h2 id="settings-what" className="mb-1 text-[0.9375rem] font-[650] text-[hsl(var(--e-foreground))]">What you see</h2>
          {isAdmin
            ? "Operations managers see only the settings their access allows; items marked “Admin” stay with administrators. Old links such as ?tab=xero still open the right page."
            : "You see the settings your access allows. Old links such as ?tab=bank still open the right page."}
        </section>
      </aside>
    </div>
  );
}
