"use client";

/**
 * "Log an item": the office records a found item (until now only cleaners
 * could). Property is required; the job is optional and chosen from that
 * property's recent jobs — with a job, the server copies its departing
 * booking's guest. Photos upload first (existing direct upload); only their
 * keys are sent. A failed save keeps everything typed.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";

type PropertyOption = { id: string; name: string; suburb: string | null };
type JobOption = { id: string; jobNumber: string; scheduledDate: string; hasBooking: boolean; bookingGuest: string | null; bookingCode: string | null };
type Photo = { key: string; url: string };
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
  return { key: body.key, url: body.url };
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
        body: JSON.stringify({ propertyId: draft.propertyId, jobId: draft.jobId || null, itemName: draft.itemName.trim(), location: draft.location.trim() || null, notes: draft.notes.trim() || null, photos: draft.photos }),
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

  return (
    <EModal open={open} onClose={() => (saving ? undefined : onClose())} eyebrow="Lost and found" title="Log an item" size="wide">
      <form onSubmit={submit}>
        <fieldset disabled={saving} className="space-y-3">
          {loadError ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{loadError}</p> : null}
          <EField label="Property">
            <ESelect required value={draft.propertyId} onChange={(event) => patch({ propertyId: event.target.value, jobId: "" })}>
              <option value="">{properties ? "Choose property" : "Loading properties…"}</option>
              {(properties ?? []).map((property) => <option key={property.id} value={property.id}>{property.suburb ? `${property.name} (${property.suburb})` : property.name}</option>)}
            </ESelect>
          </EField>
          <EField label="Job (optional)" hint="With a job, the guest is filled in from the job's departing booking.">
            <ESelect value={draft.jobId} disabled={!draft.propertyId || jobs === null} onChange={(event) => patch({ jobId: event.target.value })}>
              <option value="">{!draft.propertyId ? "Choose a property first" : jobs === null ? "Loading jobs…" : jobs.length ? "No job" : "No recent jobs at this property"}</option>
              {(jobs ?? []).map((job) => <option key={job.id} value={job.id}>{jobLabel(job, timeZone)}</option>)}
            </ESelect>
          </EField>
          {selectedJob && !selectedJob.hasBooking ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">This job has no booking, so no guest will be filled in.</p> : null}
          <EField label="Item"><EInput required maxLength={180} value={draft.itemName} onChange={(event) => patch({ itemName: event.target.value })} placeholder="e.g. Watch, silver" /></EField>
          <EField label="Where it was found (optional)"><EInput maxLength={300} value={draft.location} onChange={(event) => patch({ location: event.target.value })} placeholder="e.g. Bedside table" /></EField>
          <EField label="Notes (optional)"><ETextarea maxLength={6000} value={draft.notes} onChange={(event) => patch({ notes: event.target.value })} /></EField>
          <EField label="Photos (optional)">
            <input type="file" accept="image/*" multiple disabled={uploading || draft.photos.length >= MAX_PHOTOS} onChange={(event) => { void addPhotos(event.target.files); event.target.value = ""; }} className="block w-full text-[0.8125rem]" />
          </EField>
          {uploading ? <p role="status" className="text-[0.75rem]">Uploading…</p> : null}
          {draft.photos.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="Photos to attach">
              {draft.photos.map((photo) => (
                <li key={photo.key} className="flex items-center gap-1 text-[0.75rem]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.url} alt="" className="h-12 w-12 rounded-[6px] object-cover" />
                  <EButton type="button" size="sm" variant="ghost" onClick={() => setDraft((current) => ({ ...current, photos: current.photos.filter((candidate) => candidate.key !== photo.key) }))}>Remove</EButton>
                </li>
              ))}
            </ul>
          ) : null}
          {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton type="button" size="sm" variant="outline" onClick={onClose}>Cancel</EButton>
            <EButton type="submit" size="sm" disabled={uploading}>{saving ? "Saving…" : "Log item"}</EButton>
          </div>
        </fieldset>
      </form>
    </EModal>
  );
}
