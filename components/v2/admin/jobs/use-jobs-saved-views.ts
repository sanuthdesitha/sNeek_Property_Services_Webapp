"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { jobsViewsResponseSchema, type JobsViewAction, type JobsViews } from "@/lib/jobs/saved-views";

export function useJobsSavedViews(context: string) {
  const [data, setData] = useState<JobsViews | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [contextChanged, setContextChanged] = useState(false);
  const current = useRef({ context, data: null as JobsViews | null, pending: false, blocked: false, reload: false });
  current.current.context = context;
  const sequence = useRef(0);

  const request = useCallback(async (change?: JobsViewAction) => {
    if (current.current.pending || current.current.blocked || (change && (!current.current.data || current.current.reload))) return null;
    current.current.pending = true;
    const id = ++sequence.current;
    const previous = current.current.data;
    const revision = previous?.revision;
    const active = () => sequence.current === id && current.current.context === context;
    const invalidateContext = () => {
      current.current.blocked = true; current.current.data = null;
      setData(null); setContextChanged(true); setSaved(false);
    };
    let uncertain = Boolean(change);
    setBusy(true); setError(""); setSaved(false);
    try {
      const response = await fetch("/api/me/jobs-views", {
        method: change ? "PATCH" : "GET", cache: "no-store",
        headers: { "Content-Type": "application/json", "x-jobs-view-context": context },
        ...(change ? { body: JSON.stringify({ revision, change }) } : {}),
      });
      if (!active()) return null;
      // Authentication denials can be HTML or empty, including middleware responses.
      if (response.status === 401 || response.status === 403) {
        invalidateContext();
        throw new Error("Saved views access changed. Reload this page before continuing.");
      }
      const body: unknown = await response.json();
      if (!active()) return null;
      if (!response.ok) {
        const failure = body as { code?: string; error?: string } | null;
        if (failure?.code === "CONTEXT_CHANGED") invalidateContext();
        if (response.status === 409 || response.status === 404) { current.current.reload = true; setReloadRequired(true); }
        uncertain = Boolean(change && response.status >= 500);
        throw new Error(typeof failure?.error === "string" ? failure.error : "Saved views request failed. Retry.");
      }
      const result = jobsViewsResponseSchema.parse(body);
      if (result.context !== context) {
        invalidateContext();
        throw new Error("Your account context changed. Reload this page.");
      }
      if (change) {
        const target = "id" in change ? result.data.views.find(view => view.id === change.id) : undefined;
        const equalSnapshot = (value: unknown) => "snapshot" in change && JSON.stringify(value) === JSON.stringify(change.snapshot);
        const acknowledged = change.action === "create"
          ? result.data.views.length === previous!.views.length + 1 && result.data.views.some(view =>
            !previous!.views.some(old => old.id === view.id) && view.name === change.name.trim() && equalSnapshot(view.snapshot))
          : change.action === "update" ? Boolean(target && equalSnapshot(target.snapshot))
          : change.action === "rename" ? target?.name === change.name.trim()
          : change.action === "delete" ? !target && result.data.defaultId !== change.id
          : result.data.defaultId === change.id;
        if (result.data.revision !== revision! + 1 || !acknowledged) throw new Error("Save acknowledgment was invalid.");
      }
      current.current.data = result.data;
      current.current.reload = false;
      setData(result.data); setReloadRequired(false); setSaved(Boolean(change));
      return result.data;
    } catch (failure) {
      if (active()) {
        if (uncertain && !current.current.blocked) {
          current.current.reload = true; setReloadRequired(true);
          setError("Save outcome is unknown. Reload views to check the saved state before saving again.");
        } else setError(failure instanceof Error && !("issues" in failure)
          ? failure.message : "Saved views response was invalid. Retry loading views.");
      }
      return null;
    } finally {
      if (active()) { current.current.pending = false; setBusy(false); }
    }
  }, [context]);

  useEffect(() => {
    current.current.pending = false; current.current.data = null; current.current.blocked = false; current.current.reload = false;
    setData(null); setContextChanged(false); setReloadRequired(false);
    void request();
    return () => { sequence.current += 1; current.current.pending = false; };
  }, [request]);

  return { data, busy, error, saved, reloadRequired, contextChanged,
    reload: () => request(), mutate: (change: JobsViewAction) => request(change) };
}
