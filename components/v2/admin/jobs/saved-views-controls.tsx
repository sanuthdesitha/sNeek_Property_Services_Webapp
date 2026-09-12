"use client";
import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, RotateCcw, Save, Star, Trash2 } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { jobsSnapshot, DEFAULT_JOBS_STATE, type JobsSnapshot, type JobsWorkspaceState } from "@/lib/jobs/workspace-state";
import { viewNameSchema, type JobsViewAction } from "@/lib/jobs/saved-views";
import { JobDialog } from "./job-dialog";
import { useJobsSavedViews } from "./use-jobs-saved-views";
import { TeamDefaultControls } from "./team-default-controls";

export function SavedViewsControls({ context, readOnly, state, apply, applyDefault, snapshotInvalid = false, teamDefaultsEnabled = false }: {
  context: string; readOnly: boolean; state: JobsWorkspaceState;
  apply: (state: Partial<JobsWorkspaceState>) => void;
  applyDefault: (snapshot: JobsSnapshot) => boolean;
  snapshotInvalid?: boolean;
  teamDefaultsEnabled?: boolean;
}) {
  const views = useJobsSavedViews(context);
  const [selectedId, setSelectedId] = useState("");
  const [dialog, setDialog] = useState<"create" | "rename" | "delete" | null>(null);
  const [name, setName] = useState("");
  const [pendingChange, setPendingChange] = useState<JobsViewAction | null>(null);
  const defaultHandled = useRef(false);
  const selected = views.data?.views.find(view => view.id === selectedId);
  const snapshot = jobsSnapshot(state);
  const modified = selected && JSON.stringify(selected.snapshot) !== JSON.stringify(snapshot);
  const disabled = views.busy || !views.data || views.reloadRequired || views.contextChanged;
  const cannotWrite = disabled || readOnly;

  useEffect(() => {
    if (!views.data || views.contextChanged || defaultHandled.current) return;
    defaultHandled.current = true;
    const initial = views.data.views.find(view => view.id === views.data!.defaultId);
    if (initial && applyDefault(initial.snapshot)) setSelectedId(initial.id);
  }, [views.data, views.contextChanged, applyDefault]);

  useEffect(() => {
    if (!views.contextChanged) return;
    setSelectedId(""); setPendingChange(null); setName(""); setDialog(null);
  }, [views.contextChanged]);

  async function save(change: JobsViewAction) {
    if (snapshotInvalid && (change.action === "create" || change.action === "update")) return;
    setPendingChange(change);
    const result = await views.mutate(change);
    if (!result) return;
    setPendingChange(null);
    if (change.action === "create") setSelectedId(result.views.find(view => view.name === change.name.trim())?.id ?? "");
    if (change.action === "delete") setSelectedId("");
    setDialog(null);
  }

  function submit() {
    if (dialog === "delete" && selected) return void save({ action: "delete", id: selected.id });
    const parsed = viewNameSchema.safeParse(name);
    if (!parsed.success) return;
    if (dialog === "create") void save({ action: "create", name: parsed.data, snapshot });
    if (dialog === "rename" && selected) void save({ action: "rename", id: selected.id, name: parsed.data });
  }

  const feedback = <>
    {views.error ? <div role="alert" className="text-sm text-red-700">
      <p>{views.error}</p>
      {views.contextChanged ? <EButton size="sm" onClick={() => window.location.reload()}>Reload page</EButton>
        : <div className="flex flex-wrap gap-2">
          <EButton size="sm" disabled={views.busy} onClick={() => void views.reload()}>Reload views</EButton>
          {pendingChange && !views.reloadRequired && !readOnly ? <EButton size="sm" disabled={views.busy || snapshotInvalid} onClick={() => void save(pendingChange)}>Retry save</EButton> : null}
        </div>}
    </div> : null}
    <span role="status" className="block min-h-6 text-sm">{views.busy ? "Saving or loading views..." : views.saved ? "View saved." : ""}</span>
  </>;

  return <div className="space-y-2">
    {teamDefaultsEnabled ? <TeamDefaultControls key={context} context={context} snapshot={snapshot} snapshotInvalid={snapshotInvalid}
      personalLoaded={Boolean(views.data) && !views.contextChanged} hasPersonalDefault={Boolean(views.data?.defaultId)} applyDefault={applyDefault} /> : null}
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Personal saved view" disabled={disabled} value={selected ? selectedId : ""}
        onChange={event => {
          const view = views.data?.views.find(item => item.id === event.target.value);
          setSelectedId(view?.id ?? "");
          if (view) apply({ ...view.snapshot, page: 1 });
        }} className="h-10 min-w-0 max-w-full rounded border bg-[hsl(var(--e-surface))] px-2 text-sm sm:max-w-64">
        <option value="">Personal views</option>
        {views.data?.views.map(view => <option key={view.id} value={view.id}>{view.name}{view.id === views.data?.defaultId ? " (default)" : ""}</option>)}
      </select>
      <EButton size="sm" variant="outline" title="Save as new view" aria-label="Save as new view" disabled={cannotWrite || snapshotInvalid || (views.data?.views.length ?? 0) >= 20}
        onClick={() => { setName(""); setDialog("create"); }}><Plus className="h-4 w-4" /></EButton>
      <EButton size="sm" variant="outline" title="Update selected view" aria-label="Update selected view" disabled={cannotWrite || snapshotInvalid || !selected}
        onClick={() => selected && void save({ action: "update", id: selected.id, snapshot })}><Save className="h-4 w-4" /></EButton>
      <EButton size="sm" variant="outline" title="Rename selected view" aria-label="Rename selected view" disabled={cannotWrite || !selected}
        onClick={() => { setName(selected?.name ?? ""); setDialog("rename"); }}><Pencil className="h-4 w-4" /></EButton>
      <EButton size="sm" variant="outline" title="Delete selected view" aria-label="Delete selected view" disabled={cannotWrite || !selected}
        onClick={() => setDialog("delete")}><Trash2 className="h-4 w-4" /></EButton>
      <EButton size="sm" variant="outline" title={selected && views.data?.defaultId === selected.id ? "Remove personal default" : "Set personal default"}
        aria-label={selected && views.data?.defaultId === selected.id ? "Remove personal default" : "Set personal default"}
        aria-pressed={Boolean(selected && views.data?.defaultId === selected.id)} disabled={cannotWrite || !selected}
        onClick={() => selected && void save({ action: "default", id: views.data?.defaultId === selected.id ? null : selected.id })}>
        <Star className="h-4 w-4" fill={selected && views.data?.defaultId === selected.id ? "currentColor" : "none"} /></EButton>
      <EButton size="sm" variant="ghost" title="Reset Jobs view" aria-label="Reset Jobs view"
        onClick={() => { setSelectedId(""); apply({ ...DEFAULT_JOBS_STATE }); }}><RotateCcw className="h-4 w-4" /></EButton>
      {modified ? <span className="text-sm">Modified</span> : null}
    </div>
    {!dialog ? feedback : null}
    <JobDialog open={dialog !== null} title={dialog === "create" ? "Save view as" : dialog === "rename" ? "Rename view" : "Delete view"}
      busy={views.busy} onClose={() => setDialog(null)}>
      {dialog === "delete" ? <p className="break-words">Delete &quot;{selected?.name}&quot;?</p>
        : <label className="block text-sm">View name<input aria-label="View name" maxLength={60} value={name}
          onChange={event => setName(event.target.value)} className="mt-2 h-10 w-full rounded border bg-[hsl(var(--e-surface))] px-2" /></label>}
      {feedback}
      <div className="mt-4 flex justify-end gap-2">
        <EButton variant="outline" disabled={views.busy} onClick={() => setDialog(null)}>Cancel</EButton>
        <EButton disabled={cannotWrite || (dialog === "create" && snapshotInvalid) || (dialog !== "delete" && !viewNameSchema.safeParse(name).success)} onClick={submit}>
          {dialog === "delete" ? "Delete view" : "Save view"}
        </EButton>
      </div>
    </JobDialog>
  </div>;
}
