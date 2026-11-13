"use client";

/**
 * Phones only (board "M-InsightsForms", Forms library): the groups panel
 * behind one "All forms 18 ▾" picker. The button names the current choice
 * (All forms, a group, Drafts or Archived, plus a tag) with its real count;
 * the sheet holds the very same FormsGroupsPanel, so creating, renaming and
 * deleting groups and picking a tag work exactly as on desktop. Choosing an
 * entry closes the sheet.
 */
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { EBottomSheet } from "@/components/v2/ui/bottom-sheet";
import { EButton } from "@/components/v2/ui/primitives";
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
  const current = groupsPickerLabel(props);
  const filtered = props.scope !== "active" || props.group !== "" || props.tag !== "";
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Groups: ${current.label}${props.tag ? `, tag ${props.tag}` : ""}. Change`}
        onClick={() => setOpen(true)}
        className={cn(E_CHIP_CLASS, "min-h-11 max-w-full gap-1.5 px-3.5 text-[0.8125rem]", filtered && E_CHIP_ON_CLASS)}
      >
        <span className="truncate">{current.label}</span>
        {typeof current.count === "number" ? <span className="e-tnum">{current.count}</span> : null}
        {props.tag ? <span className="truncate">· {props.tag}</span> : null}
        <ChevronDown aria-hidden className="h-4 w-4 shrink-0" />
      </button>
      <EBottomSheet
        open={open}
        onOpenChange={setOpen}
        title="Forms"
        description="Groups, tags, drafts and archived forms"
        footer={<EButton className="w-full" onClick={() => setOpen(false)}>Done</EButton>}
      >
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
      </EBottomSheet>
    </>
  );
}
