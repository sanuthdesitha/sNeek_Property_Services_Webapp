"use client";

import { useOpsAccess } from "@/components/shared/ops-access-provider";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Building2,
  BellRing,
  Wallet,
  ShieldCheck,
  Truck,
  KeyRound,
  Settings2,
  Search,
  LayoutGrid,
} from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EInput, ESelectNative } from "./estate-form";
import {
  SETTINGS_GROUPS,
  settingsHref,
  type SettingsDestination,
} from "./settings-catalog";
import { cn } from "@/lib/utils";

const icons = {
  brand: Building2,
  notifications: BellRing,
  money: Wallet,
  quality: ShieldCheck,
  operations: Truck,
  access: KeyRound,
  system: Settings2,
};
const linkStyle =
  "inline-flex min-h-11 items-center gap-2 rounded-[var(--e-radius)] px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--e-ring))]";
const activeStyle =
  "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]";
const idleStyle =
  "text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))] hover:text-[hsl(var(--e-foreground))]";

/** Only navigation metadata crosses this boundary; settings values stay with their forms. */
export function SettingsNavigation({
  sections: suppliedSections,
  activeTab,
}: {
  sections: readonly SettingsDestination[];
  activeTab: string;
}) {
  const { canAccess } = useOpsAccess();
  const sections = suppliedSections.filter((section) => canAccess(settingsHref(section.key)));
  const router = useRouter();
  const [query, setQuery] = useState("");
  const current = sections.find((section) => section.key === activeTab);
  const groups = SETTINGS_GROUPS.filter((group) =>
    sections.some((section) => section.group === group.key),
  );
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = sections.filter((section) => {
    const group = SETTINGS_GROUPS.find((group) => group.key === section.group);
    const text =
      `${section.label} ${section.description} ${group?.label}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });

  return (
    <div className="min-w-0 space-y-4" data-settings-navigation>
      <div className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {current
                ? SETTINGS_GROUPS.find((group) => group.key === current.group)
                    ?.label
                : "Make it work your way"}
            </p>
            <p className="mt-1 text-xs text-[hsl(var(--e-muted-foreground))]">
              {current
                ? "Switch sections below or search all settings."
                : "Choose a category or search for a specific setting."}
            </p>
          </div>
          <div className="w-full sm:max-w-sm">
            <label
              htmlFor="settings-search"
              className="mb-1 block text-xs font-medium"
            >
              Search settings
            </label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-[hsl(var(--e-muted-foreground))]"
              />
              <EInput
                id="settings-search"
                data-history-disabled="true"
                autoComplete="off"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setQuery("");
                }}
                placeholder="Search rates, laundry, notifications…"
                className="min-h-11 pl-9 text-base sm:text-sm"
              />
            </div>
          </div>
        </div>

        <nav
          aria-label="Settings categories"
          className="mt-3 hidden gap-1 overflow-x-auto border-t border-[hsl(var(--e-border))] pt-3 sm:flex"
        >
          <Link
            href={settingsHref("overview")}
            prefetch={false}
            aria-current={!current ? "page" : undefined}
            className={cn(
              linkStyle,
              "shrink-0",
              !current ? activeStyle : idleStyle,
            )}
          >
            <LayoutGrid aria-hidden="true" className="h-4 w-4" /> All settings
          </Link>
          {groups.map((group) => {
            const first = sections.find(
              (section) => section.group === group.key,
            )!;
            return (
              <Link
                key={group.key}
                href={settingsHref(first.key)}
                prefetch={false}
                aria-current={current?.group === group.key ? "true" : undefined}
                className={cn(
                  linkStyle,
                  "shrink-0",
                  current?.group === group.key ? activeStyle : idleStyle,
                )}
              >
                {group.shortLabel}
              </Link>
            );
          })}
        </nav>

        <div className="mt-3 sm:hidden">
          <label
            htmlFor="settings-jump"
            className="mb-1 block text-xs font-medium"
          >
            Go to setting
          </label>
          <ESelectNative
            id="settings-jump"
            value={current?.key ?? "overview"}
            onChange={(event) => router.push(settingsHref(event.target.value))}
            className="min-h-11 appearance-auto text-base sm:text-sm"
          >
            <option value="overview">All settings</option>
            {groups.map((group) => (
              <optgroup key={group.key} label={group.label}>
                {sections
                  .filter((section) => section.group === group.key)
                  .map((section) => (
                    <option key={section.key} value={section.key}>
                      {section.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </ESelectNative>
        </div>

        {current && !terms.length ? (
          <nav
            aria-label={`${SETTINGS_GROUPS.find((group) => group.key === current.group)?.label} settings`}
            className="mt-3 hidden flex-wrap gap-1 border-t border-[hsl(var(--e-border))] pt-3 sm:flex"
          >
            {sections
              .filter((section) => section.group === current.group)
              .map((section) => (
                <Link
                  key={section.key}
                  href={settingsHref(section.key)}
                  prefetch={false}
                  aria-current={section.key === activeTab ? "page" : undefined}
                  className={cn(
                    linkStyle,
                    section.key === activeTab
                      ? "bg-[hsl(var(--e-muted))] text-[hsl(var(--e-foreground))]"
                      : idleStyle,
                  )}
                >
                  {section.label}
                </Link>
              ))}
          </nav>
        ) : null}
      </div>

      {terms.length ? (
        <section aria-label="Settings search results" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p
              role="status"
              className="text-sm text-[hsl(var(--e-muted-foreground))]"
            >
              {matches.length
                ? `${matches.length} matching setting${matches.length === 1 ? "" : "s"}`
                : "No settings found. Try a different word."}
            </p>
            <EButton
              type="button"
              variant="ghost"
              className="min-h-11"
              onClick={() => setQuery("")}
            >
              Clear search
            </EButton>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {matches.map((section) => (
              <Link
                key={section.key}
                href={settingsHref(section.key)}
                prefetch={false}
                className={cn(
                  linkStyle,
                  "items-start border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4",
                  idleStyle,
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-[hsl(var(--e-muted-foreground))]">
                    {
                      SETTINGS_GROUPS.find(
                        (group) => group.key === section.group,
                      )?.label
                    }
                  </span>
                  <span className="mt-1 block font-semibold text-[hsl(var(--e-foreground))]">
                    {section.label}
                  </span>
                  <span className="mt-1 block text-xs font-normal">
                    {section.description}
                  </span>
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="mt-1 h-4 w-4 shrink-0"
                />
              </Link>
            ))}
          </div>
        </section>
      ) : !current ? (
        <section
          aria-labelledby="settings-directory-heading"
          className="space-y-3"
        >
          <h2
            id="settings-directory-heading"
            className="text-base font-semibold"
          >
            Browse settings
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {groups.map((group) => {
              const destinations = sections.filter(
                (section) => section.group === group.key,
              );
              const Icon = icons[group.key];
              return (
                <Link
                  key={group.key}
                  href={settingsHref(destinations[0].key)}
                  prefetch={false}
                  className={cn(
                    linkStyle,
                    "group items-start border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4 sm:p-5",
                    idleStyle,
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col items-start gap-3">
                    <span className="flex items-center gap-3 sm:flex-col sm:items-start">
                      <span className="rounded-[var(--e-radius)] bg-[hsl(var(--e-muted))] p-2 text-[hsl(var(--e-accent-portal))]">
                        <Icon aria-hidden="true" className="h-5 w-5" />
                      </span>
                      <span className="text-base font-semibold text-[hsl(var(--e-foreground))]">
                        {group.label}
                      </span>
                    </span>
                    <span className="text-sm font-normal">
                      {destinations.map((section) => section.label).join(" · ")}
                    </span>
                    <span className="hidden text-xs sm:block">
                      {destinations.length}{" "}
                      {destinations.length === 1 ? "setting" : "settings"}
                    </span>
                  </span>
                  <ArrowRight
                    aria-hidden="true"
                    className="mt-2 h-4 w-4 shrink-0 transition-transform group-hover:translate-x-1"
                  />
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
