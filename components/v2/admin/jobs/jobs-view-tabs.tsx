"use client";

/**
 * View tabs: the built-in views with their live totals, then the person's own
 * saved views, then "+ Save view". A built-in tab is current when the filters
 * match its preset exactly; a saved tab when it is the selected saved view.
 */
import { cn } from "@/lib/utils";
import { BUILT_IN_VIEWS, activeBuiltInView, builtInViewFilters, type BuiltInViewId, type JobsViewCounts } from "@/lib/jobs/view-presets";
import type { JobsWorkspaceState } from "@/lib/jobs/workspace-state";
import type { JobsSavedViewsState } from "./saved-views-controls";
import type { SavedViewCounts } from "./use-saved-view-counts";

type ViewTabsProps = {
  state: JobsWorkspaceState;
  update: (patch: Partial<JobsWorkspaceState>) => void;
  counts: JobsViewCounts | null;
  /** Live totals for saved views (null while loading or when they failed). */
  savedCounts: SavedViewCounts | null;
  savedViews: JobsSavedViewsState | null;
  selectedSavedId: string;
  onSelectSaved: (id: string) => void;
  onSaveView: () => void;
  canSave: boolean;
};

const TAB = "inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[0.8125rem] font-[500] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] disabled:opacity-50";
const TAB_ON = "border-[hsl(var(--e-primary))] font-[600] text-[hsl(var(--e-primary))]";
const TAB_OFF = "border-transparent text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]";

/** "All" carries no number in the approved design; every other built-in does. */
const COUNTED: ReadonlySet<BuiltInViewId> = new Set<BuiltInViewId>(["today", "needs-cleaner", "week", "awaiting-qa", "not-invoiced"]);

export function JobsViewTabs({ state, update, counts, savedCounts, savedViews, selectedSavedId, onSelectSaved, onSaveView, canSave }: ViewTabsProps) {
  const saved = savedViews?.data?.views ?? [];
  const selectedSaved = saved.find((view) => view.id === selectedSavedId) ?? null;
  const activeBuiltIn = selectedSaved ? null : activeBuiltInView(state);
  return (
    <nav aria-label="Saved views" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
      <div className="flex min-w-max gap-1 border-b border-[hsl(var(--e-border))]">
        {BUILT_IN_VIEWS.map((view) => {
          const current = activeBuiltIn === view.id;
          const count = counts && COUNTED.has(view.id) ? counts[view.id] : null;
          return (
            <button
              key={view.id}
              type="button"
              aria-pressed={current}
              onClick={() => {
                onSelectSaved("");
                update(builtInViewFilters(view.id));
              }}
              className={cn(TAB, current ? TAB_ON : TAB_OFF)}
            >
              {view.label}
              {count !== null ? <span className="e-tnum">{count}</span> : null}
            </button>
          );
        })}
        {saved.map((view) => {
          const current = view.id === selectedSavedId;
          const total = savedCounts?.get(view.id) ?? null;
          return (
            <button
              key={view.id}
              type="button"
              aria-pressed={current}
              onClick={() => {
                onSelectSaved(view.id);
                update({ ...view.snapshot, page: 1 });
              }}
              className={cn(TAB, current ? TAB_ON : TAB_OFF)}
            >
              {view.name}
              {total && total.count !== null ? <span className="e-tnum">{total.count}</span> : null}
              {total && total.count === null ? <span className="sr-only"> (count unavailable: {total.reason})</span> : null}
              {view.id === savedViews?.data?.defaultId ? <span className="sr-only"> (your default)</span> : null}
            </button>
          );
        })}
        <button type="button" onClick={onSaveView} disabled={!canSave} className={cn(TAB, TAB_OFF)} title={canSave ? undefined : "Saved views are unavailable right now."}>
          + Save view
        </button>
      </div>
    </nav>
  );
}
