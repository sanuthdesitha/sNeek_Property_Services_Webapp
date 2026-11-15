"use client";

/**
 * "Log an item": the office records a found item (until now only cleaners
 * could). Property is required; the job is optional and chosen from that
 * property's recent jobs — with a job, the server copies its departing
 * booking's guest. Photos upload first (existing direct upload); only their
 * keys are sent. A failed save keeps everything typed.
 * Everyday dialog pattern (board "Everyday dialogs and sheets", 2026-11): the
 * guest the server will copy from the chosen job is shown BEFORE saving.
 */
import * as React from "react";
import { Plus } from "lucide-react";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { ENote, preventEnterSubmit } from "@/components/v2/ui/form-dialog-parts";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";

type PropertyOption = { id: string; name: string; suburb: string | null };
type JobOption = { id: string; jobNumber: string; scheduledDate: string; hasBooking: boolean; bookingGuest: string | null; bookingCode: string | null };
/** `preview` is a local object URL of the picked file (a private bucket link would not show). */
type Photo = { key: string; url: string; preview: string | null };
type Draft = { propertyId: string; jobId: string; itemName: string; location: string; notes: string; photos: Photo[] };

const EMPTY: Draft = { propertyId: "", jobId: "", itemName: "", location: "", notes: "", photos: [] };
const MAX_PHOTOS = 20;

async function uploadPhoto(file: File): Promise<Photo> {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", "lost-found");
  const response = await fetch("/api/uploads/direct", { method: "POST", body: form });
  const body = (await response.json().catch(() => null)) as { key?: string; url?: string; error?: string } | null;
  if (!response.ok || !body?.key || !body.url) throw new Error(body?.error ?? `Could not upload ${file.name}.`);
  return { key: body.key, url: body.url, preview: typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null };
}

function jobLabel(job: JobOption, timeZone: string): string {
  const day = new Date(job.scheduledDate).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone });
  const guest = job.hasBooking ? (job.bookingGuest ? `guest ${job.bookingGuest}` : "booking without a guest name") : "no booking";
  return `${job.jobNumber} · ${day} · ${guest}`;
}

export function LogItemDialog({ open, timeZone, onClose, onCreated }: { open: boolean; timeZone: string; onClose: () => void; onCreated: (itemId: string) => void }) {
  const [draft, setDraft] = React.useState<Draft>(EMPTY);
  const [properties, setProperties] = React.useState<PropertyOption[] | null>(null);
  const [jobs, setJobs] = React.useState<JobOption[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);

  // Properties once the dialog is first opened; jobs whenever the property changes.
  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const query = draft.propertyId ? `?propertyId=${encodeURIComponent(draft.propertyId)}` : "";
    setJobs(null);
    fetch(`/api/admin/lost-found/options${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { properties?: PropertyOption[]; jobs?: JobOption[]; error?: string } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.properties) throw new Error(body?.error ?? "Could not load properties.");
        setProperties(body.properties);
        setJobs(draft.propertyId ? body.jobs ?? [] : null);
        setLoadError(null);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : "Could not load properties.");
      });
    return () => controller.abort();
  }, [open, draft.propertyId]);

  function patch(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      const room = MAX_PHOTOS - draft.photos.length;
      const uploaded: Photo[] = [];
      for (const file of Array.from(files).slice(0, Math.max(room, 0))) uploaded.push(await uploadPhoto(file));
      setDraft((current) => ({ ...current, photos: [...current.photos, ...uploaded] }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not upload the photo.");
    } finally {
      setUploading(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.propertyId) return setError("Choose the property.");
    if (!draft.itemName.trim()) return setError("Name the item.");
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/lost-found", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: draft.propertyId, jobId: draft.jobId || null, itemName: draft.itemName.trim(), location: draft.location.trim() || null, notes: draft.notes.trim() || null, photos: draft.photos.map(({ key, url }) => ({ key, url })) }),
      });
      const body = (await response.json().catch(() => null)) as { itemId?: string; error?: string } | null;
      if (!response.ok || !body?.itemId) throw new Error(body?.error ?? `The item was not saved (${response.status}).`);
      setDraft(EMPTY);
      onCreated(body.itemId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The item was not saved.");
    } finally {
      setSaving(false);
    }
  }

  const selectedJob = jobs?.find((job) => job.id === draft.jobId) ?? null;
  const selectedProperty = properties?.find((property) => property.id === draft.propertyId) ?? null;
  const formId = React.useId();
  const PHONE_FIELD = "max-sm:h-11 max-sm:text-[1rem]";

  return (
    <EActionDialog
      open={open}
      layout="form"
      eyebrow="Lost and found"
      title="Log a found item"
      phoneTitle={selectedProperty ? `Found at ${selectedProperty.name}` : "Log a found item"}
      busy={saving}
      onClose={onClose}
      footerNote={(
        <>
          <span className="max-sm:hidden">Photos upload as you add them.</span>
          <span className="sm:hidden">The guest is told only from Lost and found, with the route you choose there.</span>
        </>
      )}
      footer={(
        <>
          <EButton type="button" size="sm" variant="outline" className="max-sm:hidden" onClick={onClose} disabled={saving}>Cancel</EButton>
          <EButton type="submit" form={formId} size="sm" disabled={saving || uploading}>{saving ? "Logging…" : "Log item"}</EButton>
        </>
      )}
    >
      <form id={formId} onSubmit={submit} onKeyDown={preventEnterSubmit}>
        <fieldset disabled={saving} className="min-w-0 space-y-3">
          {loadError ? <ENote tone="problem" role="alert">{loadError}</ENote> : null}
          <div className="grid grid-cols-2 gap-3">
            <EField label="Property">
              <ESelect required value={draft.propertyId} onChange={(event) => patch({ propertyId: event.target.value, jobId: "" })} className={PHONE_FIELD}>
                <option value="">{properties ? "Choose property" : "Loading properties…"}</option>
                {(properties ?? []).map((property) => <option key={property.id} value={property.id}>{property.suburb ? `${property.name} (${property.suburb})` : property.name}</option>)}
              </ESelect>
            </EField>
            <EField label="Job, optional">
              <ESelect value={draft.jobId} disabled={!draft.propertyId || jobs === null} onChange={(event) => patch({ jobId: event.target.value })} className={PHONE_FIELD}>
                <option value="">{!draft.propertyId ? "Choose a property first" : jobs === null ? "Loading jobs…" : jobs.length ? "No job" : "No recent jobs at this property"}</option>
                {(jobs ?? []).map((job) => <option key={job.id} value={job.id}>{jobLabel(job, timeZone)}</option>)}
              </ESelect>
            </EField>
          </div>
          {selectedJob ? (
            <ENote role="status">
              {selectedJob.hasBooking
                ? <>From {selectedJob.jobNumber}: {selectedJob.bookingGuest ? <>guest <b className="font-[600]">{selectedJob.bookingGuest}</b></> : "a booking without a guest name"}{selectedJob.bookingCode ? ` (booking ${selectedJob.bookingCode})` : ""}. Saved with the item.</>
                : <>{selectedJob.jobNumber} has no booking, so no guest will be filled in.</>}
            </ENote>
          ) : draft.propertyId ? (
            <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">With a job, the guest is filled in from the job&apos;s departing booking.</p>
          ) : null}
          <EField label="Item"><EInput required maxLength={180} value={draft.itemName} onChange={(event) => patch({ itemName: event.target.value })} placeholder="e.g. Watch, silver" className={PHONE_FIELD} /></EField>
          <EField label="Where it was found, optional"><EInput maxLength={300} value={draft.location} onChange={(event) => patch({ location: event.target.value })} placeholder="e.g. Bedside table" className={PHONE_FIELD} /></EField>
          <EField label="Notes, optional"><ETextarea rows={2} maxLength={6000} value={draft.notes} onChange={(event) => patch({ notes: event.target.value })} className="max-sm:text-[1rem]" /></EField>
          <div>
            <p className="mb-1.5 text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Photos, optional</p>
            <ul className="flex flex-wrap gap-2" aria-label="Photos to attach">
              {draft.photos.map((photo) => (
                <li key={photo.key} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {photo.preview ? <img src={photo.preview} alt="" className="h-16 w-16 rounded-[10px] object-cover" /> : <span className="flex h-16 w-16 items-center justify-center rounded-[10px] border border-[hsl(var(--e-border))] text-[0.625rem]">Uploaded</span>}
                  <EButton type="button" size="sm" variant="ghost" className="mt-1 w-16 px-0 text-[0.6875rem]" onClick={() => setDraft((current) => ({ ...current, photos: current.photos.filter((candidate) => candidate.key !== photo.key) }))}>Remove</EButton>
                </li>
              ))}
              {draft.photos.length < MAX_PHOTOS ? (
                <li>
                  <label className="relative flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[10px] border-[1.5px] border-dashed border-[hsl(var(--e-border-strong))] text-center text-[0.6875rem] text-[hsl(var(--e-text-secondary))] focus-within:ring-2 focus-within:ring-[hsl(var(--e-ring))]">
                    <Plus aria-hidden className="h-3.5 w-3.5" />
                    <span className="max-sm:hidden">Photo</span>
                    <span className="sm:hidden">Take photo</span>
                    <input type="file" accept="image/*" multiple aria-label="Add photos" disabled={uploading} onChange={(event) => { void addPhotos(event.target.files); event.target.value = ""; }} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                  </label>
                </li>
              ) : null}
            </ul>
          </div>
          {uploading ? <p role="status" className="text-[0.75rem]">Uploading…</p> : null}
          {error ? <ENote tone="problem" role="alert">Not logged: {error}</ENote> : null}
        </fieldset>
      </form>
    </EActionDialog>
  );
}
