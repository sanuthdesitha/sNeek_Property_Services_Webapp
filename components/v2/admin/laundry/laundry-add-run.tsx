"use client";

/**
 * "Add run": create one laundry run for a property's job through the existing
 * POST /api/admin/laundry (the classic admin's "Create laundry task"). Dates are
 * sent as date-only values, as the edit dialog sends them. A failed create keeps
 * what was typed.
 */
import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import { dateOnlyIso } from "@/lib/laundry/reschedule-dates";

type PropertyOption = { id: string; name: string; suburb?: string | null };
type JobOption = { id: string; jobNumber?: string | null; scheduledDate?: string | null; status?: string | null };
type Draft = { propertyId: string; jobId: string; pickupDate: string; dropoffDate: string; flagNotes: string };
const EMPTY: Draft = { propertyId: "", jobId: "", pickupDate: "", dropoffDate: "", flagNotes: "" };

function useList<T>(url: string | null): { rows: T[]; failed: boolean } {
  const [rows, setRows] = React.useState<T[]>([]);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    setRows([]);
    setFailed(false);
    if (!url) return;
    const controller = new AbortController();
    void fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error("failed");
        const list = Array.isArray(body) ? body : Array.isArray((body as { jobs?: unknown })?.jobs) ? (body as { jobs: unknown[] }).jobs : [];
        setRows(list as T[]);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [url]);
  return { rows, failed };
}

function AddRunForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [draft, setDraft] = React.useState<Draft>(EMPTY);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const properties = useList<PropertyOption>("/api/admin/properties");
  const jobs = useList<JobOption>(draft.propertyId ? `/api/jobs?paginated=1&propertyId=${encodeURIComponent(draft.propertyId)}&page=1&limit=50` : null);
  const openJobs = jobs.rows.filter((job) => job.status !== "COMPLETED" && job.status !== "INVOICED");
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  async function create() {
    if (!draft.propertyId || !draft.jobId || !draft.pickupDate || !draft.dropoffDate) {
      setError("Property, job, pickup date and drop-off date are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/laundry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: draft.propertyId,
          jobId: draft.jobId,
          pickupDate: dateOnlyIso(draft.pickupDate),
          dropoffDate: dateOnlyIso(draft.dropoffDate),
          flagNotes: draft.flagNotes.trim() || null,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not create the laundry run.");
      toast({ title: "Laundry run added" });
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the laundry run.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset disabled={saving} className="space-y-4">
      <EField label="Property" hint={properties.failed ? "Could not load properties." : undefined}>
        <ESelect value={draft.propertyId} onChange={(event) => set({ propertyId: event.target.value, jobId: "" })}>
          <option value="">Choose a property</option>
          {properties.rows.map((row) => <option key={row.id} value={row.id}>{row.name}{row.suburb ? `, ${row.suburb}` : ""}</option>)}
        </ESelect>
      </EField>
      <EField label="Job" hint={jobs.failed ? "Could not load jobs." : draft.propertyId && openJobs.length === 0 ? "No open jobs at this property." : undefined}>
        <ESelect value={draft.jobId} disabled={!draft.propertyId} onChange={(event) => set({ jobId: event.target.value })}>
          <option value="">Choose a job</option>
          {openJobs.map((job) => <option key={job.id} value={job.id}>{job.jobNumber ?? job.id.slice(-6)}{job.scheduledDate ? ` · ${job.scheduledDate.slice(0, 10)}` : ""}</option>)}
        </ESelect>
      </EField>
      <div className="grid gap-3 sm:grid-cols-2">
        <EField label="Pickup date"><EInput type="date" value={draft.pickupDate} onChange={(event) => set({ pickupDate: event.target.value })} /></EField>
        <EField label="Drop-off date"><EInput type="date" value={draft.dropoffDate} onChange={(event) => set({ dropoffDate: event.target.value })} /></EField>
      </div>
      <EField label="Notes (optional)"><ETextarea rows={2} value={draft.flagNotes} onChange={(event) => set({ flagNotes: event.target.value })} /></EField>
      {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <EButton size="sm" variant="outline" onClick={onClose}>Cancel</EButton>
        <EButton size="sm" onClick={() => void create()}>{saving ? "Adding…" : "Add run"}</EButton>
      </div>
    </fieldset>
  );
}

export function LaundryAddRun({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <EButton size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden className="h-3.5 w-3.5" /> Add run
      </EButton>
      <EModal open={open} onClose={() => setOpen(false)} title="Add laundry run" eyebrow="Laundry">
        <AddRunForm onClose={() => setOpen(false)} onCreated={() => { setOpen(false); onCreated(); }} />
      </EModal>
    </>
  );
}
