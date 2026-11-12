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
import { dayKeyOf } from "@/lib/laundry/pipeline";
import { describeLeg, outsideStatedDays, scheduleFromRow, scheduleStated } from "@/lib/laundry/partner-schedule";

/**
 * The run's laundry partner's usual windows (descriptive defaults), shown when
 * planning times, with a note when a day falls outside the stated days. Null
 * when the partner states nothing.
 */
export function PartnerScheduleHint({ task }: { task: LaundryTaskDTO }) {
  const schedule = scheduleFromRow(task.supplier ?? null);
  if (!task.supplier?.name || !scheduleStated(schedule)) return null;
  const pickup = describeLeg(schedule, "pickup");
  const drop = describeLeg(schedule, "drop");
  const notes = [
    outsideStatedDays(schedule, "pickup", dayKeyOf(task.pickupDate)) ? "The pickup day is not one of its stated pickup days." : null,
    outsideStatedDays(schedule, "drop", dayKeyOf(task.dropoffDate)) ? "The drop day is not one of its stated drop days." : null,
  ].filter(Boolean);
  return (
    <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
      {task.supplier.name} usually: {[pickup ? `pickups ${pickup}` : null, drop ? `drops ${drop}` : null].filter(Boolean).join(" · ")}.{notes.length ? ` ${notes.join(" ")}` : ""}
    </p>
  );
}

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
      <div className="flex flex-col gap-1">
        <EButton size="sm" variant="ghost" className="self-start" aria-expanded={false} onClick={() => setOpen(true)}>
          {planned ? "Edit planned times" : "Set planned times"}
        </EButton>
        <PartnerScheduleHint task={task} />
      </div>
    );
  }
  return (
    <form onSubmit={submit} aria-label="Planned times" className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2.5">
      <fieldset disabled={saving} className="grid grid-cols-2 gap-2">
        <EField label="Pickup time"><EInput type="time" step={300} value={pickup} onChange={(event) => setPickup(event.target.value)} /></EField>
        <EField label="Drop time"><EInput type="time" step={300} value={drop} onChange={(event) => setDrop(event.target.value)} /></EField>
      </fieldset>
      <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">On the run&apos;s pickup and drop days. Leave empty when no time is planned.</p>
      <PartnerScheduleHint task={task} />
      {save.status === "failed" ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{save.message}</p> : null}
      <div className="flex gap-1.5">
        <EButton type="submit" size="sm" disabled={saving}>{saving ? "Saving…" : "Save times"}</EButton>
        <EButton type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setOpen(false)}>Cancel</EButton>
      </div>
    </form>
  );
}
