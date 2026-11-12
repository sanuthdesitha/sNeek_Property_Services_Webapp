"use client";

/**
 * View options, opened from the "Columns" chip: density, optional columns,
 * reset appearance, personal saved views and the team default. The section
 * stays mounted while closed (hidden), so loading a saved or team default and
 * an unsaved view-name draft survive closing it.
 */
import { useEffect, useRef } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { DEFAULT_JOBS_STATE, type JobsSnapshot, type JobsWorkspaceState } from "@/lib/jobs/workspace-state";
import { JobsColumnsMenu } from "./jobs-columns-menu";
import { SavedViewsPanel, type JobsSavedViewsState } from "./saved-views-controls";

type ViewOptionsProps = {
  open: boolean;
  onClose: () => void;
  state: JobsWorkspaceState;
  update: (patch: Partial<JobsWorkspaceState>) => void;
  applyDefault: (snapshot: JobsSnapshot) => boolean;
  columnsError: boolean;
  viewsContext?: string;
  viewsReadOnly: boolean;
  teamDefaultsEnabled: boolean;
  savedViews: JobsSavedViewsState | null;
  selectedSavedId: string;
  onSelectSaved: (id: string) => void;
  createRequest: number;
};

export function JobsViewOptions(props: ViewOptionsProps) {
  const { open, state, update } = props;
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open) title.current?.focus();
  }, [open]);

  return (
    <section
      id="jobs-view-options"
      hidden={!open}
      aria-labelledby="jobs-view-options-title"
      className="space-y-4 rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="jobs-view-options-title" ref={title} tabIndex={-1} className="text-[0.9375rem] font-[600] focus:outline-none">View options</h2>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Sort from the column headers. These settings keep your filters.</p>
        </div>
        <EButton variant="ghost" size="sm" onClick={props.onClose}>Done</EButton>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-[0.8125rem]">
          <span className="mr-2">Density</span>
          <select
            aria-label="Jobs density"
            value={state.density}
            onChange={(event) => update({ density: event.target.value })}
            className="h-9 rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2"
          >
            <option value="compact">Compact</option>
            <option value="default">Default</option>
            <option value="comfortable">Comfortable</option>
          </select>
        </label>
        <span className="text-[0.8125rem]">Columns</span>
        <JobsColumnsMenu columns={state.columns} onChange={(columns) => update({ columns })} />
        <EButton
          variant="ghost"
          size="sm"
          onClick={() => update({ view: DEFAULT_JOBS_STATE.view, density: DEFAULT_JOBS_STATE.density, columns: { ...DEFAULT_JOBS_STATE.columns }, sort: DEFAULT_JOBS_STATE.sort })}
        >
          Reset appearance
        </EButton>
      </div>
      {props.columnsError ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">Invalid columns in this link. Choose list columns or reset the view before saving.</p> : null}
      {props.viewsContext && props.savedViews ? (
        <div className="space-y-2">
          <h3 className="text-[0.8125rem] font-[600]">Saved views and defaults</h3>
          <SavedViewsPanel
            context={props.viewsContext}
            readOnly={props.viewsReadOnly}
            state={state}
            apply={update}
            applyDefault={props.applyDefault}
            snapshotInvalid={props.columnsError}
            teamDefaultsEnabled={props.teamDefaultsEnabled}
            views={props.savedViews}
            selectedId={props.selectedSavedId}
            onSelectedIdChange={props.onSelectSaved}
            createRequest={props.createRequest}
          />
        </div>
      ) : null}
    </section>
  );
}
