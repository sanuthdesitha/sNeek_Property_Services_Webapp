"use client";

/**
 * Phones only (board "M-InsightsForms", Forms library): the groups panel
 * behind one "All forms 18 ▾" picker. The button names the current choice
 * (All forms, a group, Drafts or Archived, plus a tag) with its real count and
 * opens the very same FormsGroupsPanel under it, so creating, renaming and
 * deleting groups and picking a tag work exactly as on desktop. Choosing an
 * entry closes it.
 *
 * Drawn as a sheet; built as an in-page disclosure because the panel's group
 * "⋯" menu and its delete confirmation open in portals, which a modal bottom
 * sheet makes unclickable. The panel stays mounted while closed, so a group
 * name being typed survives closing it.
 */
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { FormsGroupsPanel, type GroupsPanelProps } from "./forms-groups-panel";

/** "All forms", the group's name, "Drafts" or "Archived", and its count when known. */
export function groupsPickerLabel(props: Pick<GroupsPanelProps, "groups" | "counts" | "scope" | "group">): { label: string; count: number | null } {
  const { groups, counts, scope, group } = props;
  if (scope === "drafts") return { label: "Drafts", count: counts?.drafts ?? null };
  if (scope === "archived") return { label: "Archived", count: counts?.archived ?? null };
  if (group) {
    const match = groups.find((item) => item.id === group);
    return { label: match?.name ?? "Selected group", count: counts?.byGroup[group] ?? match?.formCount ?? null };
  }
  return { label: "All forms", count: counts?.active ?? null };
}

export function FormsGroupsPicker(props: GroupsPanelProps) {
  const [open, setOpen] = React.useState(false);
  const regionId = React.useId();
  const current = groupsPickerLabel(props);
  const filtered = props.scope !== "active" || props.group !== "" || props.tag !== "";
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        aria-label={`Groups: ${current.label}${props.tag ? `, tag ${props.tag}` : ""}. ${open ? "Hide" : "Change"}`}
        onClick={() => setOpen((value) => !value)}
        className={cn(E_CHIP_CLASS, "min-h-11 max-w-full gap-1.5 px-3.5 text-[0.8125rem]", filtered && E_CHIP_ON_CLASS)}
      >
        <span className="truncate">{current.label}</span>
        {typeof current.count === "number" ? <span className="e-tnum">{current.count}</span> : null}
        {props.tag ? <span className="truncate">· {props.tag}</span> : null}
        <ChevronDown aria-hidden className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      <div id={regionId} hidden={!open} className="order-last basis-full" data-forms-groups-picker="">
        <FormsGroupsPanel
          {...props}
          onSelect={(patch) => {
            props.onSelect(patch);
            setOpen(false);
          }}
          onTag={(tag) => {
            props.onTag(tag);
            setOpen(false);
          }}
        />
      </div>
    </>
  );
}
