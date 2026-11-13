"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";

type PropertyOption = { id: string; name: string; suburb: string };
type OptOutState = { revision: number; propertyIds: string[]; corrupt: boolean; properties: PropertyOption[] };

/**
 * Per-property opt-out from AI photo review. Opted-out properties are never
 * queued and a queued review for one stops with the reason. Drafts survive a
 * failed save; a stale save offers to load the newer list.
 */
export function PhotoReviewOptOutPanel({ canEdit }: { canEdit: boolean }) {
  const [state, setState] = useState<OptOutState | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState<{ revision: number; propertyIds: string[] } | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setMessage("");
    try {
      const response = await fetch("/api/admin/ai/photo-review-opt-out", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!mounted.current) return;
      if (!response.ok) throw new Error(body.error || "Opted-out properties could not be loaded.");
      setState(body as OptOutState); setDraft((body as OptOutState).propertyIds);
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : "Opted-out properties could not be loaded.");
    }
  }, []);
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, [load]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (state?.properties ?? []).filter((property) => !needle || `${property.name} ${property.suburb}`.toLowerCase().includes(needle)).slice(0, 40);
  }, [state, query]);
  const dirty = state ? JSON.stringify([...draft].sort()) !== JSON.stringify([...state.propertyIds].sort()) : false;
  const names = new Map((state?.properties ?? []).map((property) => [property.id, `${property.name}${property.suburb ? `, ${property.suburb}` : ""}`]));

  async function save(revision: number) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/ai/photo-review-opt-out", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: revision, propertyIds: draft }) });
      const body = await response.json().catch(() => ({}));
      if (!mounted.current) return;
      if (response.status === 409 && body.current) { setConflict(body.current); setMessage("Someone changed this list after you opened it. Your selection is kept."); return; }
      if (!response.ok) throw new Error(body.error || "Not saved.");
      setState(body as OptOutState); setDraft((body as OptOutState).propertyIds); setConflict(null); setMessage("Saved.");
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : "Not saved.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section aria-labelledby="photo-review-opt-out-title" className="min-w-0 space-y-3 rounded-xl border p-5">
      <h2 id="photo-review-opt-out-title" className="text-lg font-semibold">Properties without AI photo review</h2>
      <p className="text-sm">Photos from these properties are never sent for AI photo review. Photo checks for duplicates and reuse still run; they use no AI.</p>
      {state?.corrupt ? <p role="alert" className="text-sm">The saved list could not be read, so AI photo review is paused for every property until it is saved again.</p> : null}
      {!state && !message ? <p role="status" className="text-sm">Loading…</p> : null}
      {state ? (
        <fieldset disabled={!canEdit || busy} className="min-w-0 space-y-3">
          <div className="flex flex-wrap gap-2">
            {draft.length === 0 ? <p className="text-sm">No properties opted out.</p> : draft.map((id) => (
              <span key={id} className="inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm">
                {names.get(id) ?? "Removed property"}
                <button type="button" className="min-h-9 underline" aria-label={`Remove ${names.get(id) ?? "property"} from the list`} onClick={() => setDraft((old) => old.filter((value) => value !== id))}>Remove</button>
              </span>
            ))}
          </div>
          <label className="block text-sm">Find a property<input className="mt-1 block min-h-11 w-full rounded border p-2" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or suburb" /></label>
          {query.trim() ? (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {matches.length === 0 ? <li className="text-sm">No matching property.</li> : matches.map((property) => (
                <li key={property.id}>
                  <label className="flex min-h-11 items-center gap-3 text-sm">
                    <input type="checkbox" checked={draft.includes(property.id)} onChange={(event) => setDraft((old) => (event.target.checked ? [...old, property.id] : old.filter((value) => value !== property.id)))} />
                    <span className="min-w-0 break-words">{property.name}{property.suburb ? `, ${property.suburb}` : ""}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <EButton type="button" disabled={!dirty || busy} onClick={() => void save(state.revision)}>{busy ? "Saving…" : "Save list"}</EButton>
            {conflict ? (
              <>
                <EButton type="button" disabled={busy} onClick={() => void save(conflict.revision)}>Save my selection anyway</EButton>
                <EButton type="button" variant="outline" disabled={busy} onClick={() => { setDraft(conflict.propertyIds); setState({ ...state, revision: conflict.revision, propertyIds: conflict.propertyIds }); setConflict(null); setMessage(""); }}>Load theirs</EButton>
              </>
            ) : null}
          </div>
        </fieldset>
      ) : null}
      {!canEdit ? <p className="text-sm">Only administrators can change this list.</p> : null}
      {message ? <p role="status" className="text-sm">{message} {!state ? <button type="button" className="underline" onClick={() => void load()}>Retry</button> : null}</p> : null}
    </section>
  );
}
