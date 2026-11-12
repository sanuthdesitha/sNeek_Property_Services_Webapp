"use client";

import * as React from "react";
import { EPill } from "@/components/v2/ui/pill";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { EFilterPopover } from "@/components/v2/ui/filter-popover";
import { ESwitch } from "@/components/v2/admin/estate-kit";
import { cn } from "@/lib/utils";
import { AUDIENCE_GROUPS, audienceGroup, type AudienceGroup } from "@/lib/notifications/wording/audience-groups";
import { CATALOG_GROUPS, type CatalogGroup } from "@/lib/notifications/catalog-types";
import type { CatalogTypeView } from "@/lib/notifications/catalog-view-types";
import type { WordingSummary } from "@/lib/notifications/wording/view-types";
import { isTypeOff, rowSwitch, transportTags } from "./type-row-switch";

export type ListFilter = "all" | "edited" | "off" | "missing";
/** Business-area filter (the old Types tab's "Notification group" chips). */
export type GroupFilter = CatalogGroup | "all";

type Props = {
  types: CatalogTypeView[];
  summaries: Map<string, WordingSummary>;
  controlsUpdatedAt: string | null;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  canSwitch: boolean;
  switching: boolean;
  onSwitch: (body: unknown) => void;
  switchNote: string | null;
};

function matches(type: CatalogTypeView, summary: WordingSummary | undefined, query: string): boolean {
  if (!query) return true;
  const text = `${type.name} ${type.trigger} ${type.audience} ${type.key}`.toLowerCase();
  return text.includes(query) || (summary?.status ?? "").toLowerCase().includes(query);
}

function countByGroup(types: CatalogTypeView[]): Map<CatalogGroup, number> {
  const counts = new Map<CatalogGroup, number>();
  for (const type of types) counts.set(type.group, (counts.get(type.group) ?? 0) + 1);
  return counts;
}

/**
 * Restores the old Types tab's filter by notification group (business area),
 * as a popover so the narrow list keeps its search, status chips and audience
 * headings. Counts are over every type, as the old chips counted them.
 */
function GroupFilterControl({ types, value, onChange }: { types: CatalogTypeView[]; value: GroupFilter; onChange: (next: GroupFilter) => void }) {
  const counts = countByGroup(types);
  const options: Array<{ key: GroupFilter; label: string; count: number }> = [
    { key: "all", label: "All groups", count: types.length },
    ...CATALOG_GROUPS.map((group) => ({ key: group, label: group, count: counts.get(group) ?? 0 })),
  ];
  return (
    <EFilterPopover label="Group" value={value === "all" ? null : value} emptyValue="All" className="ml-auto">
      <fieldset className="space-y-0.5">
        <legend className="sr-only">Notification group</legend>
        {options.map((option) => (
          <label key={option.key} className="flex min-h-10 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-[hsl(var(--e-muted))]">
            <input type="radio" name="notification-type-group" value={option.key} checked={value === option.key} onChange={() => onChange(option.key)} />
            <span className="min-w-0 flex-1">{option.label}</span>
            <span className="e-tnum text-xs text-[hsl(var(--e-muted-foreground))]">{option.count}</span>
          </label>
        ))}
      </fieldset>
    </EFilterPopover>
  );
}

function TypeRow({ type, summary, selected, onSelect, props }: { type: CatalogTypeView; summary: WordingSummary | undefined; selected: boolean; onSelect: () => void; props: Props }) {
  const state = rowSwitch(type, props.controlsUpdatedAt);
  return (
    <li className={cn("flex min-h-11 items-center gap-2 rounded-[var(--e-radius)] px-2 py-1 text-[0.8125rem]", selected && "bg-[hsl(var(--e-primary-soft))]")}>
      <button type="button" onClick={onSelect} aria-current={selected ? "true" : undefined} className="min-w-0 flex-1 py-1 text-left [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--e-ring))]">
        <span className={cn(selected && "font-semibold")}>{type.name}</span>
        {summary?.status === "IN_CODE" ? <EPill className="ml-1">In code</EPill> : null}
        {summary && summary.problems > 0 ? <EPill tone="warn" className="ml-1">{summary.problems} var</EPill> : null}
        {summary?.edited ? <span className="sr-only"> (edited)</span> : null}
      </button>
      <span className="flex shrink-0 flex-wrap justify-end gap-0.5" aria-label="Transports">
        {transportTags(type).map((tag) => (
          <span key={tag.key} className={cn("inline-flex h-[17px] items-center rounded px-1 text-[0.625rem] font-semibold border", tag.on ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]" : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-muted-foreground))]")}>
            {tag.key}<span className="sr-only">{tag.on ? " on" : " not used by default"}</span>
          </span>
        ))}
      </span>
      {state.kind === "toggle" ? (
        <ESwitch checked={state.on} disabled={!props.canSwitch || props.switching} onCheckedChange={(on) => props.onSwitch(state.patch(on))} label={<span className="sr-only">{`${type.name} ${state.on ? "on" : "off"}`}</span>} />
      ) : (
        <EPill tone={state.tone}>{state.label}</EPill>
      )}
    </li>
  );
}

export function TypeList(props: Props) {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<ListFilter>("all");
  const [group, setGroup] = React.useState<GroupFilter>("all");
  const needle = query.trim().toLowerCase();
  const counts = {
    all: props.types.length,
    edited: props.types.filter((type) => props.summaries.get(type.key)?.edited).length,
    off: props.types.filter((type) => isTypeOff(type, props.controlsUpdatedAt)).length,
    missing: props.types.filter((type) => (props.summaries.get(type.key)?.problems ?? 0) > 0).length,
  };
  const visible = props.types.filter((type) => {
    const summary = props.summaries.get(type.key);
    if (!matches(type, summary, needle)) return false;
    if (group !== "all" && type.group !== group) return false;
    if (filter === "edited") return Boolean(summary?.edited);
    if (filter === "off") return isTypeOff(type, props.controlsUpdatedAt);
    if (filter === "missing") return (summary?.problems ?? 0) > 0;
    return true;
  });
  const grouped = new Map<AudienceGroup, CatalogTypeView[]>();
  for (const type of visible) {
    const group = audienceGroup(type);
    grouped.set(group, [...(grouped.get(group) ?? []), type]);
  }
  const chips: Array<{ key: ListFilter; label: string }> = [
    { key: "all", label: "All" }, { key: "edited", label: "Edited" }, { key: "off", label: "Off" }, { key: "missing", label: "Missing a variable" },
  ];

  return (
    <section aria-label="Notification types" className="flex min-w-0 flex-col gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3 lg:w-[300px] lg:flex-none">
      <label htmlFor="notification-type-search" className="sr-only">Search notifications</label>
      <input id="notification-type-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notifications and wording"
        className="h-11 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 text-base sm:h-9 sm:text-sm" />
      <div role="group" aria-label="Filter notification types" className="my-1.5 flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <button key={chip.key} type="button" aria-pressed={filter === chip.key} onClick={() => setFilter(chip.key)} className={cn(E_CHIP_CLASS, filter === chip.key && E_CHIP_ON_CLASS)}>
            {chip.label} <span className="e-tnum">{counts[chip.key]}</span>
          </button>
        ))}
        <GroupFilterControl types={props.types} value={group} onChange={setGroup} />
      </div>
      <div className="flex justify-between px-2 text-xs text-[hsl(var(--e-muted-foreground))]" aria-hidden="true"><span>Notification</span><span>On · transports</span></div>
      {props.switchNote ? <p className="px-2 text-xs text-[hsl(var(--e-muted-foreground))]">{props.switchNote}</p> : null}
      <div className="max-h-[60vh] overflow-y-auto lg:max-h-none">
        {visible.length === 0 ? <p className="px-2 py-3 text-sm text-[hsl(var(--e-muted-foreground))]">No notification matches this search or filter.</p> : null}
        {AUDIENCE_GROUPS.map((group) => {
          const rows = grouped.get(group) ?? [];
          if (!rows.length) return null;
          const headingId = `type-group-${group.toLowerCase()}`;
          return (
            <div key={group} className="mt-2">
              <h3 id={headingId} className="px-2 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">{group} <span className="e-tnum">{rows.length}</span></h3>
              <ul aria-labelledby={headingId} className="mt-1 space-y-0.5">
                {rows.map((type) => (
                  <TypeRow key={type.key} type={type} summary={props.summaries.get(type.key)} selected={type.key === props.selectedKey} onSelect={() => props.onSelect(type.key)} props={props} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
