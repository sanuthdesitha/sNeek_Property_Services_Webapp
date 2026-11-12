"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { OpsPolicy } from "@/lib/rbac/ops-policy";
import {
  PERSON_GROUP_LABELS,
  personGroup,
  personSummaryLine,
  type AccessPerson,
  type AssistantTeam,
  type PersonGroup,
} from "@/lib/rbac/access-screen-types";
import { AccessBadge } from "./access-badges";
import { displayName, initials } from "./access-labels";

export type AccessSelection = { kind: "person"; id: string } | { kind: "team"; id: string };
type Filter = "all" | "unsaved" | "stale";

const GROUPS: PersonGroup[] = ["admin", "manager", "assistant", "other"];
const OWN_PORTAL_LABELS: Array<[string, string]> = [["CLEANER", "Cleaners"], ["QA_INSPECTOR", "QA inspectors"], ["LAUNDRY", "Laundry team"], ["MAINTENANCE", "Maintenance"]];

function Avatar({ name, email }: { name: string | null; email: string | null }) {
  return (
    <span aria-hidden className="inline-flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-[hsl(var(--e-primary-soft))] text-[0.6875rem] font-[600] text-[hsl(var(--e-primary))]">
      {initials(name, email)}
    </span>
  );
}

const rowClass = (on: boolean) =>
  cn(
    "flex w-full min-h-11 items-center gap-2.5 rounded-[var(--e-radius)] px-2 py-1.5 text-left text-[0.8125rem] text-[hsl(var(--e-foreground))]",
    "hover:bg-[hsl(var(--e-muted))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--e-ring))]",
    on && "bg-[hsl(var(--e-primary-soft))] hover:bg-[hsl(var(--e-primary-soft))]",
  );

export function AccessPeopleList({
  people,
  teams,
  ownPortalCounts,
  draft,
  selection,
  unsaved,
  stale,
  disabled,
  onSelect,
}: {
  people: AccessPerson[];
  teams: AssistantTeam[];
  ownPortalCounts: Record<string, number>;
  draft: OpsPolicy;
  selection: AccessSelection | null;
  unsaved: ReadonlySet<string>;
  stale: ReadonlySet<string>;
  disabled: boolean;
  onSelect: (selection: AccessSelection) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const needle = query.trim().toLowerCase();
  const visible = people.filter((person) => {
    if (needle && !`${person.name ?? ""} ${person.email ?? ""}`.toLowerCase().includes(needle)) return false;
    if (filter === "unsaved") return unsaved.has(person.id);
    if (filter === "stale") return stale.has(person.id);
    return true;
  });
  const visibleTeams = teams.filter((team) => !needle || `${team.name} ${team.clientName}`.toLowerCase().includes(needle));
  const chips: Array<[Filter, string, number]> = [["all", "All", people.length], ["unsaved", "Unsaved", unsaved.size], ["stale", "Stale", stale.size]];

  return (
    <section aria-label="People with office access" className="flex min-w-0 flex-col gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3 lg:w-[244px] lg:flex-none">
      <input
        type="search"
        aria-label="Search people"
        placeholder="Search name or email"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="min-h-10 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-base sm:text-[0.875rem]"
      />
      <div className="my-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Filter people">
        {chips.map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={cn(
              "min-h-8 rounded-[var(--e-radius-pill)] border px-2.5 text-[0.75rem]",
              filter === key ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))] font-[600]" : "border-[hsl(var(--e-border))]",
            )}
          >
            {label} {count}
          </button>
        ))}
      </div>
      {GROUPS.map((group) => {
        const members = visible.filter((person) => personGroup(draft, person) === group);
        if (members.length === 0) return null;
        return (
          <div key={group} className="mt-1.5 flex flex-col gap-0.5">
            <p className="e-eyebrow">{PERSON_GROUP_LABELS[group]} {members.length}</p>
            {members.map((person) => {
              const on = selection?.kind === "person" && selection.id === person.id;
              return (
                <button key={person.id} type="button" disabled={disabled && !on} aria-current={on ? "true" : undefined} onClick={() => onSelect({ kind: "person", id: person.id })} className={rowClass(on)}>
                  <Avatar name={person.name} email={person.email} />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate">{displayName(person)}</b>
                    <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{personSummaryLine(draft, person)}</span>
                  </span>
                  {unsaved.has(person.id) ? <AccessBadge tone="gold">Unsaved</AccessBadge> : stale.has(person.id) ? <AccessBadge tone="warn">Review</AccessBadge> : null}
                </button>
              );
            })}
          </div>
        );
      })}
      {visible.length === 0 ? <p className="py-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No one matches.</p> : null}
      <hr className="my-2 border-[hsl(var(--e-border))]" />
      <p className="e-eyebrow">Own portal only, no office areas</p>
      <p className="text-[0.75rem] leading-relaxed text-[hsl(var(--e-muted-foreground))]">
        {OWN_PORTAL_LABELS.map(([role, label]) => `${label} ${ownPortalCounts[role] ?? 0}`).join(" · ")}
        <br />
        <a className="underline" href="/v2/admin/accounts">Open in Accounts</a> to give one of them office access.
      </p>
      <hr className="my-2 border-[hsl(var(--e-border))]" />
      <p className="e-eyebrow">Client assistants {teams.reduce((sum, team) => sum + team.memberCount, 0)}</p>
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        They act for a client in the client portal, so their access is set per client team.{" "}
        <a className="underline" href="/v2/admin/accounts?tab=assistants">Open assistants</a>
      </p>
      {visibleTeams.map((team) => {
        const on = selection?.kind === "team" && selection.id === team.id;
        return (
          <button key={team.id} type="button" disabled={disabled && !on} aria-current={on ? "true" : undefined} onClick={() => onSelect({ kind: "team", id: team.id })} className={rowClass(on)}>
            <Avatar name={team.clientName} email={null} />
            <span className="min-w-0 flex-1">
              <b className="block truncate">{team.name}</b>
              <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                {team.clientName} · {team.memberCount} {team.memberCount === 1 ? "assistant" : "assistants"}
              </span>
            </span>
            {!team.isActive ? <AccessBadge>Paused</AccessBadge> : null}
          </button>
        );
      })}
    </section>
  );
}
