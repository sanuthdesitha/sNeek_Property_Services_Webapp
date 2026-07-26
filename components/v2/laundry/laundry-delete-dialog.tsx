"use client";

/**
 * ESTATE — laundry task delete confirmation.
 *
 * Wraps DELETE /api/laundry/[taskId]. Two modes, because LaundryTask.jobId is
 * @unique and the planner recreates tasks from jobs:
 *   • "Remove from the boards" (default) — soft delete (SKIPPED_PICKUP +
 *     noPickupRequired). Hidden everywhere, and the planner leaves it alone.
 *   • "Delete permanently" — really drops the row + its confirmations. The
 *     dialog says out loud that the planner can recreate it from the job.
 *
 * Laundry-role users never see this: they keep the existing failed-pickup
 * "request skip/delete approval" flow, and the server refuses them anyway.
 */
import * as React from "react";
import { format } from "date-fns";
import { AlertTriangle, Trash2 } from "lucide-react";
import { EModal } from "@/components/v2/admin/estate-kit";
import { EButton } from "@/components/v2/ui/primitives";
import { ECheckbox, EField, ETextarea } from "@/components/v2/cleaner/fields";

export type DeletableLaundryTask = {
  id: string;
  status: string;
  pickupDate: string;
  dropoffDate: string;
  droppedAt?: string | null;
  property?: { name?: string | null; suburb?: string | null } | null;
};

export type LaundryDeletePayload = {
  mode: "SUPPRESS" | "PERMANENT";
  force?: boolean;
  reason?: string;
};

function label(task: DeletableLaundryTask) {
  const name = task.property?.name ?? "Property";
  const suburb = task.property?.suburb ?? "";
  return suburb ? `${name}, ${suburb}` : name;
}

function safeDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : format(d, "EEE d MMM yyyy");
}

/**
 * `onConfirm` performs the actual request (the boards do it optimistically via
 * their feed hook). Return true to close, false to keep the dialog open.
 */
export function useLaundryDeleteDialog<T extends DeletableLaundryTask>(
  onConfirm: (task: T, payload: LaundryDeletePayload) => Promise<boolean>,
) {
  const [task, setTask] = React.useState<T | null>(null);
  const [mode, setMode] = React.useState<"SUPPRESS" | "PERMANENT">("SUPPRESS");
  const [reason, setReason] = React.useState("");
  const [force, setForce] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const requestDelete = React.useCallback((next: T) => {
    setTask(next);
    setMode("SUPPRESS");
    setReason("");
    setForce(false);
  }, []);

  const completed = task ? task.status === "DROPPED" || Boolean(task.droppedAt) : false;
  const blocked = completed && !force;

  async function confirm() {
    if (!task || busy || blocked) return;
    setBusy(true);
    try {
      const closed = await onConfirm(task, {
        mode,
        force: completed ? true : undefined,
        reason: reason.trim() || undefined,
      });
      if (closed) setTask(null);
    } finally {
      setBusy(false);
    }
  }

  const modal = task ? (
    <EModal open onClose={() => (busy ? undefined : setTask(null))} eyebrow="Laundry" title="Delete this laundry set?">
      <div className="space-y-5">
        <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] px-3 py-2.5">
          <p className="text-[0.875rem] font-[550]">{label(task)}</p>
          <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Pickup {safeDate(task.pickupDate)} · Return {safeDate(task.dropoffDate)}
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-[0.75rem] font-[550] uppercase tracking-wide text-[hsl(var(--e-muted-foreground))]">
            How should it be removed?
          </legend>
          {(
            [
              {
                value: "SUPPRESS" as const,
                title: "Remove from the boards",
                blurb:
                  "Marks the set as skipped so it disappears from Queue, Runs, Tracking and the route builder. The plan generator will not bring it back. Recommended.",
              },
              {
                value: "PERMANENT" as const,
                title: "Delete permanently",
                blurb:
                  "Deletes the record and its pickup/return evidence for good. The plan generator can recreate a fresh task for this clean unless the job is cancelled or the property has laundry turned off.",
              },
            ]
          ).map((option) => (
            <label
              key={option.value}
              className={
                "flex cursor-pointer gap-2.5 rounded-[var(--e-radius)] border px-3 py-2.5 transition-colors " +
                (mode === option.value
                  ? "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-raised))]"
                  : "border-[hsl(var(--e-border))] hover:bg-[hsl(var(--e-muted))]")
              }
            >
              <input
                type="radio"
                name="laundry-delete-mode"
                className="mt-1 h-3.5 w-3.5 shrink-0 accent-[hsl(var(--e-danger))]"
                checked={mode === option.value}
                onChange={() => setMode(option.value)}
              />
              <span className="min-w-0">
                <span className="block text-[0.8125rem] font-[550]">{option.title}</span>
                <span className="mt-0.5 block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {option.blurb}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <EField label="Reason" hint="Recorded in the activity log and the audit trail.">
          <ETextarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. guest cancelled, linen handled in-house"
          />
        </EField>

        {completed ? (
          <div className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-danger)/0.4)] bg-[hsl(var(--e-danger)/0.06)] px-3 py-2.5">
            <p className="inline-flex items-start gap-2 text-[0.75rem] text-[hsl(var(--e-danger))]">
              <AlertTriangle className="mt-[0.1rem] h-3.5 w-3.5 shrink-0" />
              This set has already been returned. Deleting it removes completed evidence, weights and
              costs from reporting. Full admins only.
            </p>
            <label className="flex cursor-pointer items-center gap-2 text-[0.75rem] font-[550]">
              <ECheckbox checked={force} onChange={(e) => setForce(e.target.checked)} />
              I understand and want to delete a completed set.
            </label>
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
          <EButton variant="ghost" disabled={busy} onClick={() => setTask(null)}>
            Cancel
          </EButton>
          <EButton variant="danger" disabled={busy || blocked} onClick={() => void confirm()}>
            <Trash2 className="h-3.5 w-3.5" />
            {busy ? "Deleting…" : mode === "PERMANENT" ? "Delete permanently" : "Remove"}
          </EButton>
        </div>
      </div>
    </EModal>
  ) : null;

  return { requestDelete, modal };
}
