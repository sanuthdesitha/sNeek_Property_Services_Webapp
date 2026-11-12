"use client";

/**
 * Run panel: planned pickup and drop clock times (Wave F), a lazy disclosure
 * ("Set times" / "Edit times"). Saved with the run's stale-write guard; a
 * cleared field saves "not planned" (null), never a guessed time. The days
 * stay as they are (Reschedule moves days). Keyed by run id by its parent.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput } from "@/components/v2/admin/estate-kit";
import type { LaundryTaskDTO } from "./laundry-shared";

type Save = { status: "idle" } | { status: "saving" } | { status: "failed"; message: string };

export function LaundryPlannedTimes({ task, onSaved }: { task: LaundryTaskDTO; onSaved: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [pickup, setPickup] = React.useState(task.pickupTime ?? "");
  const [drop, setDrop] = React.useState(task.dropoffTime ?? "");
  const [save, setSave] = React.useState<Save>({ status: "idle" });
  const saving = save.status === "saving";
  const planned = task.pickupTime || task.dropoffTime;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSave({ status: "saving" });
    try {
      const response = await fetch(`/api/admin/laundry/${encodeURIComponent(task.id)}/times`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pickupTime: pickup || null, dropoffTime: drop || null, ...(task.updatedAt ? { expectedUpdatedAt: task.updatedAt } : {}) }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Not saved (${response.status}).`);
      setSave({ status: "idle" });
      setOpen(false);
      onSaved();
    } catch (error) {
      setSave({ status: "failed", message: error instanceof Error ? error.message : "Not saved." });
    }
  }

  if (!open) {
    return (
      <EButton size="sm" variant="ghost" className="self-start" aria-expanded={false} onClick={() => setOpen(true)}>
        {planned ? "Edit planned times" : "Set planned times"}
      </EButton>
    );
  }
  return (
    <form onSubmit={submit} aria-label="Planned times" className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2.5">
      <fieldset disabled={saving} className="grid grid-cols-2 gap-2">
        <EField label="Pickup time"><EInput type="time" step={300} value={pickup} onChange={(event) => setPickup(event.target.value)} /></EField>
        <EField label="Drop time"><EInput type="time" step={300} value={drop} onChange={(event) => setDrop(event.target.value)} /></EField>
      </fieldset>
      <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">On the run&apos;s pickup and drop days. Leave empty when no time is planned.</p>
      {save.status === "failed" ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{save.message}</p> : null}
      <div className="flex gap-1.5">
        <EButton type="submit" size="sm" disabled={saving}>{saving ? "Saving…" : "Save times"}</EButton>
        <EButton type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setOpen(false)}>Cancel</EButton>
      </div>
    </form>
  );
}
