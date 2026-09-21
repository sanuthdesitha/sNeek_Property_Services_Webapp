"use client";
import * as React from "react";
import { useSession } from "next-auth/react";
import { z } from "zod";
import { EButton, ECard, ECardBody, ECardHeader, ECardTitle } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";

const propertySchema = z.object({ id: z.string().min(1), name: z.string().min(1) });
const safeImageUrl = (value: string) => /^https?:\/\//i.test(value) || (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\"));
const itemSchema = z.object({ id: z.string().min(1), fieldId: z.string().min(1), fieldLabel: z.string(), sectionLabel: z.string(), submittedAt: z.string().refine(value => Number.isFinite(Date.parse(value))), url: z.string().refine(safeImageUrl).nullable(), excluded: z.boolean() });
const trainingSchema = z.object({ status: z.string(), error: z.string().nullable().optional(), modelVersion: z.string().nullable().optional(), lastTrainedAt: z.string().nullable().optional(), metrics: z.record(z.unknown()).nullable().optional() });
const pageSchema = z.object({ property: propertySchema, items: z.array(itemSchema).max(60), nextOffset: z.number().int().nonnegative().nullable(), training: trainingSchema.nullable().optional(), modelConfigured: z.boolean().optional(), trainingEnabled: z.boolean().optional() });
type Property = z.infer<typeof propertySchema>;
type Item = z.infer<typeof itemSchema>;

export function PropertyPhotoMemoryPanel({ canEdit }: { canEdit: boolean }) {
  const { data: session, status } = useSession();
  if (status !== "authenticated" || !session?.user?.id) return null;
  if (session.impersonation) return <p className="text-sm">Exit impersonation to review property photo memory.</p>;
  const roles = session.user.heldRoles ?? [session.user.role];
  return <PropertyMemory key={JSON.stringify([session.user.id, roles])} canEdit={canEdit && roles.includes("ADMIN")} />;
}

function PropertyMemory({ canEdit }: { canEdit: boolean }) {
  const [query, setQuery] = React.useState("");
  const [properties, setProperties] = React.useState<Property[]>([]);
  const [selected, setSelected] = React.useState<Property | null>(null);
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState("");
  const generation = React.useRef(0), controller = React.useRef<AbortController>();
  const search = React.useCallback(async (q: string) => {
    const request = ++generation.current; controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/admin/ai/photo-memory?q=${encodeURIComponent(q.trim())}`, { cache: "no-store", signal: abort.signal });
      const body = await response.json(); if (request !== generation.current) return;
      const parsed = z.object({ properties: z.array(propertySchema).max(50) }).safeParse(body);
      if (!response.ok || !parsed.success) throw new Error(response.ok ? "Property results were not valid. Try searching again." : body.error || "Properties could not be loaded.");
      setProperties(parsed.data.properties);
    } catch (error) { if (request === generation.current) { setProperties([]); setError(error instanceof Error ? error.message : "Properties could not be loaded."); } }
    finally { if (request === generation.current) setBusy(false); }
  }, []);
  React.useEffect(() => { void search(""); return () => { generation.current++; controller.current?.abort(); }; }, [search]);
  const choices = selected && !properties.some(property => property.id === selected.id) ? [selected, ...properties] : properties;
  return <ECard className="min-w-0 [overflow-wrap:anywhere]">
    <ECardHeader><ECardTitle>Property photo memory</ECardTitle></ECardHeader>
    <ECardBody className="space-y-4">
      <p className="text-sm">Historical labelled photos are shown below. Only compatible recent examples from the latest submission for each job are sampled. They help identify rooms and photo sections; they do not set QA cleanliness standards or fine-tune the base AI model.</p>
      <p className="text-sm">Excluding an example stops its use in photo memory. The original submission and evidence remain unchanged. Enable or disable property memory in vision settings above.</p>
      {!canEdit ? <p className="text-sm">Read-only access. An administrator can exclude or restore examples.</p> : null}
      <form className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end" onSubmit={event => { event.preventDefault(); void search(query); }}>
        <EField label="Search properties" className="min-w-0 flex-1"><EInput aria-label="Search properties" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} placeholder="Property name" /></EField>
        <EButton type="submit" className="min-h-11" disabled={busy}>{busy ? "Searching…" : "Search properties"}</EButton>
      </form>
      {error ? <p role="alert" className="text-sm">{error}</p> : null}
      {!busy && !error && !properties.length ? <p role="status" className="text-sm">No matching properties.</p> : null}
      <EField label="Property"><ESelect aria-label="Property" className="min-w-0" value={selected?.id ?? ""} onChange={event => setSelected(choices.find(property => property.id === event.target.value) ?? null)}><option value="">Choose a property</option>{choices.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</ESelect></EField>
      {selected ? <MemoryItems key={selected.id} property={selected} canEdit={canEdit} /> : <p className="text-sm text-[hsl(var(--e-muted-foreground))]">Choose a property to review its submitted examples.</p>}
    </ECardBody>
  </ECard>;
}

function MemoryItems({ property, canEdit }: { property: Property; canEdit: boolean }) {
  const [items, setItems] = React.useState<Item[]>([]), [nextOffset, setNextOffset] = React.useState<number | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [loading, setLoading] = React.useState(false), [writing, setWriting] = React.useState(false), [uncertain, setUncertain] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [training, setTraining] = React.useState<z.infer<typeof trainingSchema> | null>(null);
  const [modelConfigured, setModelConfigured] = React.useState(false), [trainingEnabled, setTrainingEnabled] = React.useState(false);
  const [editor, setEditor] = React.useState<{ id: string; excluded: boolean } | null>(null), [reason, setReason] = React.useState("");
  const generation = React.useRef(0), controller = React.useRef<AbortController>();
  const mounted = React.useRef(true), writeLock = React.useRef(false);
  const load = React.useCallback(async (offset = 0) => {
    const request = ++generation.current; controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setLoading(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/ai/photo-memory?propertyId=${encodeURIComponent(property.id)}&offset=${offset}`, { cache: "no-store", signal: abort.signal });
      const body = await response.json(); if (request !== generation.current) return false;
      const parsed = pageSchema.safeParse(body);
      if (!response.ok || !parsed.success || parsed.data.property.id !== property.id || new Set(parsed.data.items.map(item => item.id)).size !== parsed.data.items.length || (parsed.data.nextOffset !== null && parsed.data.nextOffset <= offset)) throw new Error(!response.ok && typeof body.error === "string" ? body.error : "Photo memory could not be verified. Refresh to try again.");
      setItems(current => offset === 0 ? parsed.data.items : [...current, ...parsed.data.items.filter(item => !current.some(existing => existing.id === item.id))]);
      setNextOffset(parsed.data.nextOffset); setLoaded(true); setUncertain(false); if (offset === 0) { setEditor(null); setReason(""); }
      setTraining(parsed.data.training ?? null); setModelConfigured(parsed.data.modelConfigured === true); setTrainingEnabled(parsed.data.trainingEnabled === true);
      return true;
    } catch (error) { if (request === generation.current) { setUncertain(true); setMessage(error instanceof Error ? error.message : "Photo memory could not be loaded."); } return false; }
    finally { if (request === generation.current) setLoading(false); }
  }, [property.id]);
  React.useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; generation.current++; controller.current?.abort(); }; }, [load]);
  async function save() {
    if (!editor || !canEdit || writeLock.current || loading || uncertain) return;
    if (reason.trim().length < 3 || reason.trim().length > 1000) { setMessage("Enter a reason between 3 and 1000 characters."); return; }
    writeLock.current = true; setWriting(true); setMessage("");
    try {
      const response = await fetch("/api/admin/ai/photo-memory", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ propertyId: property.id, mediaId: editor.id, excluded: editor.excluded, reason: reason.trim() }) });
      const body = await response.json(); if (!mounted.current) return;
      if (!response.ok || body.ok !== true) throw new Error(typeof body.error === "string" ? body.error : "Change was not confirmed.");
      setEditor(null); setReason("");
      const refreshed = await load(); if (mounted.current) setMessage(refreshed ? "Photo memory updated. Original evidence is unchanged." : "Change saved, but the refreshed list is unavailable. Refresh before making another change.");
      if (!refreshed && mounted.current) setUncertain(true);
    } catch (error) {
      if (mounted.current) { setUncertain(true); setMessage(`${error instanceof Error ? error.message : "Change was not confirmed."} Refresh before trying again; do not assume it was unsaved.`); }
    } finally { writeLock.current = false; if (mounted.current) setWriting(false); }
  }
  async function train() {
    if (!canEdit || !modelConfigured || !trainingEnabled || writeLock.current || loading || uncertain || editor) return;
    writeLock.current = true; setWriting(true); setMessage("");
    try {
      const response = await fetch("/api/admin/ai/photo-memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ propertyId: property.id }) });
      const body = await response.json(); if (!mounted.current) return;
      if (!response.ok || body.ok !== true) throw new Error(typeof body.error === "string" ? body.error : "Training request was not confirmed.");
      const refreshed = await load(); if (mounted.current) { setUncertain(!refreshed); setMessage(refreshed ? "Training request queued. Refresh to check model status." : "Training request queued, but model status could not be refreshed."); }
    } catch (error) { if (mounted.current) { setUncertain(true); setMessage(`${error instanceof Error ? error.message : "Training request was not confirmed."} Refresh before retrying.`); } }
    finally { writeLock.current = false; if (mounted.current) setWriting(false); }
  }
  const groups = new Map<string, Item[]>();
  for (const item of items) { const key = JSON.stringify([item.sectionLabel, item.fieldId, item.fieldLabel]); groups.set(key, [...(groups.get(key) ?? []), item]); }
  return <section aria-label={`Photo memory for ${property.name}`} className="min-w-0 space-y-4 border-t border-[hsl(var(--e-border))] pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="min-w-0 font-semibold">{property.name}</h3><EButton className="h-auto min-h-11 whitespace-normal py-2" variant="outline" disabled={loading || writing} onClick={() => void load()}>Refresh examples and model</EButton></div>
    <section aria-label="Property model training" className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
      <h4 className="text-sm font-semibold">Property-specific location model</h4>
      <p className="text-sm">Train or update a versioned location model from reviewed labels for this property. When enabled, new submissions queue automatic updates.</p>
      <p className="text-sm">Status: {training?.status ?? "No training recorded"}{training?.modelVersion ? ` · Version ${training.modelVersion}` : ""}</p>
      {training?.lastTrainedAt && Number.isFinite(Date.parse(training.lastTrainedAt)) ? <p className="text-xs">Last trained: {new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Sydney" }).format(new Date(training.lastTrainedAt))} (Sydney)</p> : null}
      {!modelConfigured ? <p className="text-sm">The location model is not configured.</p> : !trainingEnabled ? <p className="text-sm">Model training is disabled in settings.</p> : null}
      <EButton className="h-auto min-h-11 whitespace-normal py-2" disabled={!canEdit || !modelConfigured || !trainingEnabled || loading || writing || uncertain || !!editor} onClick={() => void train()}>Train / update model</EButton>
    </section>
    {message ? <p role="status" className="text-sm">{message}</p> : null}
    {loading ? <p role="status" className="text-sm">Loading examples…</p> : null}
    {loaded && !loading && !items.length ? <p className="text-sm">No valid labelled examples on this page.{nextOffset !== null ? " More submission records are available below." : ""}</p> : null}
    {Array.from(groups.entries()).map(([key, rows]) => <section key={key} className="space-y-3"><h4 className="text-sm font-semibold">{rows[0].sectionLabel || "Section"} · {rows[0].fieldLabel || rows[0].fieldId}</h4><div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map(item => <article key={item.id} className="min-w-0 space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
        {item.url ? <a href={item.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.fieldLabel} example`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}<img src={item.url} alt={`${item.fieldLabel} submitted example`} loading="lazy" className="aspect-video w-full rounded object-cover" />
        </a> : <p className="text-sm">Image preview unavailable.</p>}
        <p className="text-xs">Submitted <time dateTime={item.submittedAt}>{new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Sydney" }).format(new Date(item.submittedAt))}</time> (Sydney)</p>
        <p className="text-sm font-medium">{item.excluded ? "Excluded from memory" : "Not excluded from memory"}</p>
        {canEdit ? <EButton className="h-auto min-h-11 whitespace-normal py-2" variant="outline" disabled={writing || loading || uncertain} onClick={() => { setEditor({ id: item.id, excluded: !item.excluded }); setReason(""); setMessage(""); }}>{item.excluded ? "Restore example" : "Exclude example"}</EButton> : null}
        {editor?.id === item.id ? <form className="space-y-2" onSubmit={event => { event.preventDefault(); void save(); }}><EField label="Reason for this change"><ETextarea aria-label="Reason for this change" value={reason} maxLength={1000} rows={3} disabled={writing || uncertain} onChange={event => setReason(event.target.value)} /></EField><div className="flex flex-wrap gap-2"><EButton type="submit" className="min-h-11" disabled={writing || loading || uncertain}>{writing ? "Saving…" : editor.excluded ? "Confirm exclusion" : "Confirm restoration"}</EButton><EButton className="min-h-11" type="button" variant="ghost" disabled={writing} onClick={() => setEditor(null)}>Cancel change</EButton></div></form> : null}
      </article>)}
    </div></section>)}
    {nextOffset !== null ? <EButton className="min-h-11 w-full" variant="outline" disabled={loading || writing || uncertain} onClick={() => void load(nextOffset)}>Load more examples</EButton> : null}
  </section>;
}
