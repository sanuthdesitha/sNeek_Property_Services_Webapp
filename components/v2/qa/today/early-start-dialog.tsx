"use client";

/**
 * "Start anyway" for an inspection whose clean is not submitted yet. Same
 * contract as the queue workspace: `POST /api/qa/jobs/[id]/pickup` answers
 * 409 INSPECTION_REASON_REQUIRED without a reason; with a reason (10+
 * characters) it starts and nudges the cleaner to finish the form.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EModal, ETextarea } from "@/components/v2/admin/estate-kit";

export type PickupResult =
  | { kind: "started" }
  | { kind: "reason-required"; message: string }
  | { kind: "failed"; message: string };

export async function requestQaPickup(jobId: string, reason?: string): Promise<PickupResult> {
  try {
    const res = await fetch(`/api/qa/jobs/${jobId}/pickup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reason ? { reason } : {}),
    });
    const body: { error?: string; code?: string } = await res.json().catch(() => ({}));
    if (res.ok) return { kind: "started" };
    if (body.code === "INSPECTION_REASON_REQUIRED") return { kind: "reason-required", message: body.error ?? "" };
    return { kind: "failed", message: body.error ?? "Could not start the inspection. Please retry." };
  } catch {
    return { kind: "failed", message: "You appear to be offline. Nothing was started." };
  }
}

export function EarlyStartDialog({
  open,
  propertyName,
  message,
  onCancel,
  onStarted,
  jobId,
}: {
  open: boolean;
  propertyName: string;
  message: string;
  jobId: string;
  onCancel: () => void;
  onStarted: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // A different job starts a fresh reason.
  React.useEffect(() => {
    setReason("");
    setError(null);
  }, [jobId]);

  async function confirm() {
    setSaving(true);
    setError(null);
    const result = await requestQaPickup(jobId, reason.trim());
    setSaving(false);
    if (result.kind === "started") {
      onStarted();
      return;
    }
    // The reason stays in the box so a retry does not lose it.
    setError(result.message || "Could not start the inspection. Please retry.");
  }

  return (
    <EModal open={open} onClose={onCancel} title={`Start ${propertyName} before the form is submitted?`}>
      <div className="space-y-3">
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          {message || "The cleaner has not submitted their form yet."}
        </p>
        <label htmlFor="qa-early-start-reason" className="block text-[0.8125rem] font-[550]">
          Why are you inspecting now?
        </label>
        <ETextarea
          id="qa-early-start-reason"
          value={reason}
          disabled={saving}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. guest checks in at 2pm and the cleaner has left site"
          className="min-h-[90px]"
        />
        <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
          The cleaner is notified to complete their form. Your reason is saved on the inspection.
        </p>
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <EButton variant="ghost" onClick={onCancel} disabled={saving}>Cancel</EButton>
          <EButton variant="gold" disabled={saving || reason.trim().length < 10} onClick={() => void confirm()}>
            {saving ? "Starting…" : "Start anyway"}
          </EButton>
        </div>
      </div>
    </EModal>
  );
}
