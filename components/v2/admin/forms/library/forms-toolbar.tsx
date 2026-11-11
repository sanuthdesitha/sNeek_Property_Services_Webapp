"use client";

/**
 * Search (form names and question labels), the Status and Used by filters and
 * the "Has problems" chip above the Job forms table.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { EInput } from "@/components/v2/admin/estate-kit";
import { EFilterPopover } from "@/components/v2/ui/filter-popover";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import type { FormLibraryStatusFilter, FormLibraryUsedByFilter } from "@/lib/forms/library-types";
import type { FormsListState } from "./use-forms-library";

const STATUS_OPTIONS: Array<{ key: FormLibraryStatusFilter; label: string }> = [
  { key: "any", label: "Any status" },
  { key: "live", label: "Live" },
  { key: "live-draft", label: "Live + draft" },
  { key: "draft", label: "Draft (not published)" },
];

const USED_BY_OPTIONS: Array<{ key: FormLibraryUsedByFilter; label: string }> = [
  { key: "any", label: "Anything" },
  { key: "default", label: "Default for its job type" },
  { key: "property", label: "Property override" },
  { key: "job", label: "Made for one job" },
  { key: "unused", label: "Not used" },
];

function Options<T extends string>({ name, options, value, onChange }: { name: string; options: Array<{ key: T; label: string }>; value: T; onChange: (v: T) => void }) {
  return (
    <div className="space-y-1.5">
      {options.map((option) => (
        <label key={option.key} className="flex items-center gap-2 text-[0.8125rem]">
          <input type="radio" name={name} className="accent-[hsl(var(--e-primary))]" checked={value === option.key} onChange={() => onChange(option.key)} />
          {option.label}
        </label>
      ))}
    </div>
  );
}

const SEARCH_DELAY_MS = 300;

export function FormsToolbar({ state, update, problemCount }: { state: FormsListState; update: (patch: Partial<FormsListState>) => void; problemCount: number | null }) {
  const [search, setSearch] = React.useState(state.q);
  const searchId = React.useId();

  const pushedRef = React.useRef(state.q);

  // Follow the URL when it changes from elsewhere (back/forward, a tab link),
  // but never overwrite what is being typed with this box's own earlier value.
  React.useEffect(() => {
    if (state.q === pushedRef.current) return;
    pushedRef.current = state.q;
    setSearch(state.q);
  }, [state.q]);

  React.useEffect(() => {
    if (search === pushedRef.current) return;
    const timer = window.setTimeout(() => {
      pushedRef.current = search;
      update({ q: search });
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [search, update]);

  const statusLabel = STATUS_OPTIONS.find((o) => o.key === state.status && o.key !== "any")?.label ?? null;
  const usedByLabel = USED_BY_OPTIONS.find((o) => o.key === state.usedBy && o.key !== "any")?.label ?? null;

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <label htmlFor={searchId} className="sr-only">Search forms</label>
      <EInput
        id={searchId}
        type="search"
        className="h-[34px] w-full sm:w-[240px]"
        placeholder="Search forms and questions"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <EFilterPopover label="Status" value={statusLabel}>
        <Options name="forms-status" options={STATUS_OPTIONS} value={state.status} onChange={(status) => update({ status })} />
      </EFilterPopover>
      <EFilterPopover label="Used by" value={usedByLabel}>
        <Options name="forms-used-by" options={USED_BY_OPTIONS} value={state.usedBy} onChange={(usedBy) => update({ usedBy })} />
      </EFilterPopover>
      <button
        type="button"
        aria-pressed={state.problems}
        onClick={() => update({ problems: !state.problems })}
        className={cn(E_CHIP_CLASS, state.problems && E_CHIP_ON_CLASS)}
      >
        Has problems{typeof problemCount === "number" ? <span className="e-tnum">{problemCount}</span> : null}
      </button>
    </div>
  );
}
